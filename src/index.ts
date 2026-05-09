import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { EmoteState } from "./types.js";
import type { Renderer } from "./renderer.js";
import { log, setDebug } from "./log.js";
import { loadLayeredConfig } from "./config.js";
import { resolveEmoteSet, findEmoteSetDir, loadEmotesConfig } from "./emotes.js";
import { KittyRenderer } from "./render_kitty.js";
import { ITermRenderer } from "./render_iterm.js";
import { AsciiRenderer } from "./render_ascii.js";
import { Animator } from "./animator.js";
import { createWidgetFactory } from "./widget.js";

function toolNameToState(toolName: string): EmoteState {
  switch (toolName) {
    case "read": return "read";
    case "write":
    case "edit": return "write";
    default: return "tool";
  }
}

function isWezTerm(): boolean {
  return process.env.TERM_PROGRAM?.toLowerCase() === "wezterm" || !!process.env.WEZTERM_PANE;
}

function createRenderer(config: any): Renderer {
  if (isWezTerm()) {
    log(`createRenderer: using ITermRenderer (WezTerm)`);
    return new ITermRenderer(config.size);
  }

  const caps = getCapabilities();

  if (caps.images === "kitty") {
    log(`createRenderer: using KittyRenderer`);
    return new KittyRenderer(config.size);
  }
  if (caps.images === "iterm2") {
    log(`createRenderer: using ITermRenderer`);
    return new ITermRenderer(config.size);
  }
  log(`createRenderer: using AsciiRenderer (no image support)`);
  return new AsciiRenderer();
}

export default function (pi: ExtensionAPI) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const extDir = dirname(__dirname);

  let cwd = process.cwd();
  let config = loadLayeredConfig(extDir, cwd);
  setDebug(config.debug);

  if (!config.enabled) return;

  // Emote set state
  let currentEmoteSet = "default";
  let ctxRef: any = null;
  let widgetActive = false;
  let renderer = createRenderer(config);

  const animator = new Animator(config, renderer);

  function loadEmoteSet(setName: string) {
    currentEmoteSet = setName;

    // "ascii" emote set forces AsciiRenderer regardless of terminal
    if (setName === "ascii") {
      if (!(renderer instanceof AsciiRenderer)) {
        renderer = new AsciiRenderer();
        animator.setRenderer(renderer);
      }
      renderer.loadFrames("", extDir);
      animator.setEmotesConfig({});
      return;
    }

    // Non-ascii set: ensure we're using the capability-based renderer
    const detected = createRenderer(config);
    if (renderer.constructor !== detected.constructor) {
      renderer = detected;
      animator.setRenderer(renderer);
    }

    const setDir = findEmoteSetDir(setName, extDir, cwd);
    const emotesConfig = loadEmotesConfig(setDir);
    renderer.loadFrames(setDir, extDir);
    animator.setEmotesConfig(emotesConfig);
  }

  loadEmoteSet("default");

  function switchEmoteSetForModel(modelId: string) {
    const setName = resolveEmoteSet(modelId, config.emotes);
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
    config = loadLayeredConfig(extDir, cwd);
    setDebug(config.debug);
    animator.updateConfig(config);

    // Re-create renderer in case terminal capabilities changed
    renderer = createRenderer(config);
    animator.setRenderer(renderer);

    if (renderer instanceof AsciiRenderer) {
      ctx.ui.notify("[pi-emote] No image protocol detected \u2014 using ASCII emotes.", "warning");
    }

    ctxRef = ctx;

    if (!config.enabled) return;

    // Resolve emote set for current model
    const modelId = ctx.model?.id ?? "";
    const setName = resolveEmoteSet(modelId, config.emotes);
    log(`session_start: model="${modelId}" set="${setName}" dir="${findEmoteSetDir(setName, extDir, cwd)}"`);
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
    const resolved = resolveEmoteSet(modelId, config.emotes);
    log(`model_select: model="${modelId}" resolved="${resolved}" current="${currentEmoteSet}"`);
    switchEmoteSetForModel(modelId);
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
