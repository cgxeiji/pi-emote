import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";

import type { EmoteState, ResolvedRenderer } from "./types.js";
import type { Renderer } from "./renderer.js";
import { log, setDebug } from "./log.js";
import { loadLayeredConfig } from "./config.js";
import { resolveEmoteSet, findEmoteSetDir, loadEmotesConfig } from "./emotes.js";
import { KittyRenderer } from "./render_kitty.js";
import { TmuxKittyRenderer } from "./render_tmux_kitty.js";
import { TmuxKittyUnicodeRenderer } from "./render_tmux_kitty_unicode.js";
import { ITermRenderer } from "./render_iterm.js";
import { TmuxITermRenderer } from "./render_tmux_iterm.js";
import { AsciiRenderer } from "./render_ascii.js";
import { Animator } from "./animator.js";
import { createWidgetFactory } from "./widget.js";
import { resolveRenderer } from "./terminal.js";

const IMAGE_STATES = ["hi", "idle", "think", "talk", "read", "write", "tool", "success", "failure", "compact"];

/** Check if a set directory contains any image frames (PNG files in state subdirs). */
function hasImageFrames(setDir: string): boolean {
  for (const state of IMAGE_STATES) {
    const stateDir = join(setDir, state);
    if (existsSync(stateDir)) {
      const files = readdirSync(stateDir).filter((f) => f.endsWith(".png"));
      if (files.length > 0) return true;
    }
  }
  return false;
}

function toolNameToState(toolName: string): EmoteState {
  switch (toolName) {
    case "read": return "read";
    case "write":
    case "edit": return "write";
    default: return "tool";
  }
}

function createRendererFromResolved(resolved: ResolvedRenderer, size: number): Renderer {
  const { protocol, multiplexer } = resolved;
  if (protocol === "kitty-unicode") {
    log(`createRenderer: using TmuxKittyUnicodeRenderer`);
    return new TmuxKittyUnicodeRenderer(size);
  }
  if (protocol === "kitty") {
    if (multiplexer === "tmux") {
      log(`createRenderer: using TmuxKittyRenderer`);
      return new TmuxKittyRenderer(size);
    }
    log(`createRenderer: using KittyRenderer`);
    return new KittyRenderer(size);
  }
  if (protocol === "iterm2") {
    if (multiplexer === "tmux") {
      log(`createRenderer: using TmuxITermRenderer`);
      return new TmuxITermRenderer(size);
    }
    log(`createRenderer: using ITermRenderer`);
    return new ITermRenderer(size);
  }
  log(`createRenderer: using AsciiRenderer`);
  return new AsciiRenderer();
}

export default function (pi: ExtensionAPI) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const extDir = dirname(__dirname);

  let cwd = process.cwd();
  let { config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd);
  setDebug(config.debug);

  if (!config.enabled) return;

  // Emote set state
  let currentEmoteSet = "default";
  let ctxRef: any = null;
  let widgetActive = false;
  let lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
  let renderer = createRendererFromResolved(lastResolved, config.size);

  const animator = new Animator(config, renderer);

  function loadEmoteSet(setName: string) {
    currentEmoteSet = setName;

    const setDir = findEmoteSetDir(setName, extDir, cwd);
    const isAsciiOnly = existsSync(join(setDir, "ascii.yaml")) && !hasImageFrames(setDir);

    if (isAsciiOnly) {
      // ASCII-only set — use AsciiRenderer regardless of terminal
      if (!(renderer instanceof AsciiRenderer)) {
        renderer = new AsciiRenderer();
        animator.setRenderer(renderer);
      }
    } else {
      // Ensure we're using the capability-based renderer
      const detected = createRendererFromResolved(lastResolved, config.size);
      if (renderer.constructor !== detected.constructor) {
        renderer = detected;
        animator.setRenderer(renderer);
      }
    }

    const emotesConfig = loadEmotesConfig(setDir);
    renderer.loadFrames(setDir, extDir);
    animator.setEmotesConfig(emotesConfig);
  }

  loadEmoteSet("default");

  function switchEmoteSet(modelId: string, thinkingLevel: string) {
    const setName = resolveEmoteSet(modelId, thinkingLevel, config.emotes);
    if (setName !== currentEmoteSet) {
      loadEmoteSet(setName);
      log(`switchEmoteSet: loaded "${setName}", state="${animator.currentState}"`);
      animator.resetRenderCache();
      if (widgetActive && animator.currentState === "idle") {
        animator.enterIdle();
      } else if (widgetActive) {
        renderer.showRandomFrame(animator.currentState, true);
      }
    }
  }

  // --- Events ---

  pi.on("session_start", async (_event, ctx) => {
    log(`session_start: hasUI=${ctx.hasUI}`);
    if (!ctx.hasUI) return;

    animator.clearAllTimers();
    cwd = ctx.cwd;
    ({ config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd));
    setDebug(config.debug);
    animator.updateConfig(config);

    // Re-create renderer in case terminal capabilities changed
    lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
    renderer = createRendererFromResolved(lastResolved, config.size);
    animator.setRenderer(renderer);

    if (lastResolved.warning) {
      ctx.ui.notify(lastResolved.warning, lastResolved.warningLevel);
    } else if (renderer instanceof AsciiRenderer) {
      ctx.ui.notify("[pi-emote] No image protocol detected \u2014 using ASCII emotes.", "warning");
    }

    ctxRef = ctx;

    if (!config.enabled) return;

    // Resolve emote set for current model and thinking level
    const modelId = ctx.model?.id ?? "";
    const thinkingLevel = pi.getThinkingLevel();
    const setName = resolveEmoteSet(modelId, thinkingLevel, config.emotes);
    log(`session_start: model="${modelId}" thinkingLevel="${thinkingLevel}" set="${setName}" dir="${findEmoteSetDir(setName, extDir, cwd)}"`);
    loadEmoteSet(setName);

    // Create widget
    ctx.ui.setWidget("emote", createWidgetFactory({
      animator,
      config,
      pi,
      getCtxRef: () => ctxRef,
      getCurrentEmoteSet: () => currentEmoteSet,
    }), { placement: "aboveEditor" });

    widgetActive = true;
    setTimeout(() => animator.transitionTo("hi"), 500);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    animator.clearAllTimers();
    animator.disposeRenderer();
    if (widgetActive && ctx.hasUI) {
      ctx.ui.setWidget("emote", undefined);
      widgetActive = false;
    }
    animator.setTui(null);
    ctxRef = null;
  });

  pi.on("model_select", async (event) => {
    if (!widgetActive) return;
    const modelId = event.model?.id ?? "";
    const thinkingLevel = pi.getThinkingLevel();
    const resolved = resolveEmoteSet(modelId, thinkingLevel, config.emotes);
    log(`model_select: model="${modelId}" thinkingLevel="${thinkingLevel}" resolved="${resolved}" current="${currentEmoteSet}"`);
    switchEmoteSet(modelId, thinkingLevel);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (!widgetActive) return;
    const modelId = ctx.model?.id ?? "";
    const resolved = resolveEmoteSet(modelId, event.level, config.emotes);
    log(`thinking_level_select: model="${modelId}" thinkingLevel="${event.level}" resolved="${resolved}" current="${currentEmoteSet}"`);
    switchEmoteSet(modelId, event.level);
  });

  pi.on("message_update", async (event) => {
    if (!widgetActive) return;
    if (event.message?.role !== "assistant") return;

    const streamEvent = event.assistantMessageEvent;
    if (!streamEvent) return;

    if (streamEvent.type === "thinking_start" || streamEvent.type === "thinking_delta") {
      if (animator.currentState !== "think") {
        animator.transitionTo("think");
      }
      return;
    }

    if (streamEvent.type === "toolcall_start") {
      const partial = streamEvent.partial;
      const block = partial?.content?.[streamEvent.contentIndex];
      if (block && "name" in block && block.name) {
        animator.transitionTo(toolNameToState(block.name));
      } else {
        animator.transitionTo("tool");
      }
      return;
    }

    if (streamEvent.type !== "text_delta") return;
    const text = streamEvent.delta;
    if (!text) return;

    if (animator.currentState !== "talk") {
      animator.transitionTo("talk");
    }
    animator.onTalkToken(text);
  });

  pi.on("agent_end", async () => {
    if (!widgetActive) return;
    if (animator.currentState === "talk") {
      animator.endTalk();
    } else if (animator.currentState !== "idle" && animator.currentState !== "hi" && animator.currentState !== "compact") {
      animator.transitionTo("idle");
    }
  });

  pi.on("tool_execution_start", async (event) => {
    if (!widgetActive) return;
    animator.transitionTo(toolNameToState(event.toolName));
  });

  pi.on("tool_execution_end", async (event) => {
    if (!widgetActive) return;
    if (event.toolName === "bash" && event.isError) {
      animator.setHoldNextState("read");
      animator.transitionTo("failure");
    } else {
      animator.transitionTo("read");
    }
  });

  pi.on("session_before_compact", async () => {
    if (!widgetActive) return;
    animator.transitionTo("compact");
  });

  pi.on("session_compact", async () => {
    if (!widgetActive) return;
    animator.transitionTo("idle");
  });
}
