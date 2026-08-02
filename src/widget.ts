import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { Config, WidgetColor } from "./types.js";
import type { Animator } from "./animator.js";
import type { RenderedFrame } from "./renderer.js";
import { log } from "./log.js";
import { resolveProgressColor } from "./theme.js";

// --- Token formatting ---

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}K`;
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

// --- Progress bar ---

function buildProgressBar(usage: any, latestCacheRead: number, latestInput: number, latestCacheWrite: number): string {
  const segments = 20;
  const subsPerSegment = 8;
  const totalSubs = segments * subsPerSegment;
  const percent = usage?.percent ?? 0;
  
  // Granular sub-unit fill with floor-fill minimum of one full segment
  const filledSubs = percent === 0 ? 0 : Math.max(Math.ceil((percent / 100) * totalSubs), subsPerSegment);
  
  // Calculate cache vs input ratio from latest message
  const totalPrompt = latestInput + latestCacheRead + latestCacheWrite;
  const cacheRatio = totalPrompt > 0 ? latestCacheRead / totalPrompt : 0;
  const cacheSubs = Math.floor(filledSubs * cacheRatio);
  
  const eighthBlockChars = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
  
  const bar = Array.from({ length: segments }, (_, i) => {
    const segStart = i * subsPerSegment;
    const segEnd = segStart + subsPerSegment;
    
    const cacheInSeg = Math.max(0, Math.min(cacheSubs, segEnd) - segStart);
    const inputInSeg = Math.max(0, Math.min(filledSubs, segEnd) - Math.max(cacheSubs, segStart));
    
    // If cache and input share a bin, input fills the bin at 100%
    if (cacheInSeg > 0 && inputInSeg > 0) return '█';
    if (inputInSeg > 0) return eighthBlockChars[inputInSeg - 1];
    if (cacheInSeg > 0) return '░';
    return ' ';
  }).join('');
  
  const pctStr = percent.toFixed(1);
  const tokensStr = usage?.tokens != null ? formatTokens(usage.tokens) : '?';
  return `⏵▕${bar}▏ ${tokensStr} (${pctStr}%)`;
}

// --- Info panel ---

// --- Info panel ---

/** Resolve a widget color to a text styler. "thinking-level-color" follows the current thinking level. */
function colorStyler(color: WidgetColor, thinking: (s: string) => string, theme: any): (s: string) => string {
  if (color === "thinking-level-color") return thinking;
  return (s: string) => theme.fg(color, s);
}

function buildInfoLines(width: number, avatarWidth: number, ctxRef: any, pi: any, theme: any, config: any): string[] {
  const lines: string[] = [];
  if (!ctxRef) return lines;

  // Line 1: Model + thinking level + context window
  const model = ctxRef.model;
  let modelStr = model?.name ?? "no model";
  const thinkingLevel = pi.getThinkingLevel?.() ?? "high";
  if (model?.reasoning) {
    modelStr += ` • ${thinkingLevel}`;
  }
  
  const usage = ctxRef.getContextUsage?.();
  if (usage) {
    const window = formatTokens(usage.contextWindow);
    modelStr += ` • ${window}`;
  }
  lines.push(modelStr);

  // Line 2: Progress bar
  // Calculate cumulative totals and extract latest message stats
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let latestInput = 0;
  let latestCacheRead = 0;
  let latestCacheWrite = 0;
  
  try {
    const entries = ctxRef.sessionManager.getEntries();
    for (const entry of entries) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        const msgInput = entry.message.usage?.input ?? 0;
        const msgCacheRead = entry.message.usage?.cacheRead ?? 0;
        const msgCacheWrite = entry.message.usage?.cacheWrite ?? 0;
        
        totalInput += msgInput;
        totalOutput += entry.message.usage?.output ?? 0;
        totalCost += entry.message.usage?.cost?.total ?? 0;
        
        // Keep track of the latest message's stats
        latestInput = msgInput;
        latestCacheRead = msgCacheRead;
        latestCacheWrite = msgCacheWrite;
      }
    }
  } catch (_) { /* ignore if not available */ }

  const progressBar = buildProgressBar(usage, latestCacheRead, latestInput, latestCacheWrite);
  lines.push(progressBar);

  // Line 3: Stats with cache hit rate
  // Calculate cache hit rate using pi's formula
  const latestPromptTokens = latestInput + latestCacheRead + latestCacheWrite;
  const cacheHitRate = latestPromptTokens > 0 ? (latestCacheRead / latestPromptTokens) * 100 : 0;
  
  const statsStr = `↑${formatTokens(totalInput)} ↓${formatTokens(totalOutput)} ⇞${cacheHitRate.toFixed(1)}% $${totalCost.toFixed(3)}`;
  lines.push(statsStr);

  // Line 4: Current working directory
  let pwd = ctxRef.sessionManager.getCwd?.() ?? process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && pwd.startsWith(home)) {
    pwd = `~${pwd.slice(home.length)}`;
  }
  lines.push(pwd);

  const infoWidth = width - avatarWidth - 5;

  const thinkingStyler = theme.getThinkingBorderColor?.(thinkingLevel)
    ?? ((s: string) => theme.fg("border", s));
  const wt = config.theme;
  const styleModel = (s: string) => theme.bold(colorStyler(wt["model-name"] ?? "accent", thinkingStyler, theme)(s));
  const styleProgress = colorStyler(resolveProgressColor(usage?.percent ?? 0, cacheHitRate, wt["progress-bar"] ?? {}), thinkingStyler, theme);
  const styleStats = colorStyler(wt["token-info"] ?? "dim", thinkingStyler, theme);
  const stylePwd = colorStyler(wt["working-directory"] ?? "warning", thinkingStyler, theme);
  const styleFns = [styleModel, styleProgress, styleStats, stylePwd];

  return lines.map((l, i) => {
    if (visibleWidth(l) > infoWidth) l = truncateToWidth(l, infoWidth, "…");
    return styleFns[i](l);
  });
}

// --- Render helpers ---

/**
 * Kitty image layout: image sequence on row 0 (zero-width, cursor doesn't move),
 * avatarPad fills the space. Info text beside the image on all rows.
 */
function renderKittyFrame(frame: RenderedFrame & { kind: "image" }, width: number, config: Config, infoLines: string[], separatorColor: (s: string) => string): string[] {
  const sep = separatorColor("│");
  const leftMargin = " ";
  const avatarPad = " ".repeat(config.size);
  const avatarSkip = `\x1b[${config.size}C`;
  const useSkip = frame.padMode === "skip";
  const lines: string[] = [];

  for (let i = 0; i < frame.rows; i++) {
    if (i === 0) {
      const pad = useSkip ? avatarSkip : avatarPad;
      lines.push(leftMargin + frame.sequence + `${pad} ${sep} ${infoLines[i] ?? ""}`);
    } else {
      lines.push(`${leftMargin}${avatarPad} ${sep} ${infoLines[i] ?? ""}`);
    }
  }

  return lines;
}

/**
 * iTerm2 image layout — text first, image last.
 *
 * The TUI processes lines top-to-bottom, erasing each with \x1b[2K before
 * writing. By placing the image on the LAST widget row with cursor-up
 * positioning, the image is rendered AFTER all line clears. It extends
 * downward over rows that already have text, filling the image area
 * (cols 1–size) without being erased. Text in cols (size+1)+ is preserved.
 *
 * Layout: frame.rows total (frame.rows-1 text rows + 1 image row).
 */
function renderITermFrame(frame: RenderedFrame & { kind: "image" }, width: number, config: Config, infoLines: string[], separatorColor: (s: string) => string): string[] {
  const sep = separatorColor("│");
  const size = config.size;
  const skipPad = `\x1b[${1 + size}C`;
  const lines: string[] = [];

  for (let i = 0; i < frame.rows; i++) {
    if (i < frame.rows - 1) {
      // Text rows: cursor-right past image area, then info
      lines.push(`${skipPad} ${sep} ${infoLines[i] ?? ""}`);
    } else {
      // Last row: cursor-up to first text row, place image, then text
      // After the image, cursor returns to this row (last image row, col 0).
      const up = frame.rows > 1 ? `\x1b[${frame.rows - 1}A` : "";
      lines.push(`${up}\x1b[1C${frame.sequence} ${sep} ${infoLines[i] ?? ""}`);
    }
  }

  return lines;
}

const TEXT_CANVAS_COLS = 8;
const TEXT_CANVAS_ROWS = 4;

function renderTextFrame(frame: RenderedFrame & { kind: "text" }, width: number, _config: Config, infoLines: string[], separatorColor: (s: string) => string): string[] {
  const sep = separatorColor("│");
  const leftMargin = " ";
  const avatarPad = " ".repeat(TEXT_CANVAS_COLS);

  // Fixed 8×4 canvas, vertically center the frame lines.
  const emoteLines = frame.lines;
  const rowCount = Math.max(TEXT_CANVAS_ROWS, infoLines.length);
  const emoteStart = Math.floor((rowCount - emoteLines.length) / 2);
  const lines: string[] = [];

  for (let i = 0; i < rowCount; i++) {
    const emoteIdx = i - emoteStart;
    const emote = (emoteIdx >= 0 && emoteIdx < emoteLines.length) ? emoteLines[emoteIdx] : "";
    const emoteWidth = visibleWidth(emote);
    // Warn if a line exceeds the canvas width
    if (emoteWidth > TEXT_CANVAS_COLS) {
      log(`AsciiRenderer: line ${emoteIdx} exceeds ${TEXT_CANVAS_COLS} cols (${emoteWidth})`);
    }
    // Center within canvas
    const totalPad = TEXT_CANVAS_COLS - emoteWidth;
    const padLeft = totalPad > 0 ? " ".repeat(Math.floor(totalPad / 2)) : "";
    const padRight = totalPad > 0 ? " ".repeat(Math.ceil(totalPad / 2)) : "";
    const cell = emote ? `${padLeft}${emote}${padRight}` : avatarPad;
    lines.push(`${leftMargin}${cell} ${sep} ${infoLines[i] ?? ""}`);
  }

  return lines;
}

/**
 * Unicode placeholder layout: placeholder text lines fill rows 0–N.
 * Each line is already config.size wide (placeholder chars). Info beside it.
 */
function renderPlaceholderFrame(frame: RenderedFrame & { kind: "placeholder" }, width: number, config: Config, infoLines: string[], separatorColor: (s: string) => string): string[] {
  const sep = separatorColor("│");
  const leftMargin = " ";
  const lines: string[] = [];

  for (let i = 0; i < frame.rows; i++) {
    lines.push(`${leftMargin}${frame.lines[i] ?? ""} ${sep} ${infoLines[i] ?? ""}`);
  }

  return lines;
}

// --- Widget factory ---

export interface WidgetDeps {
  animator: Animator;
  config: Config;
  pi: any;
  getCtxRef: () => any;
  getCurrentEmoteSet: () => string;
}

export function createWidgetFactory(deps: WidgetDeps) {
  return (_tui: any, theme: any) => {
    deps.animator.setTui(_tui);
    return {
      render(width: number): string[] {
        const { animator, config } = deps;

        if (width < config.hideBelow) return [];

        const frame = animator.getRenderedFrame();
        if (!frame) {
          log(`render: no frame`);
          return [];
        }

        log(`render: kind=${frame.kind}, set="${deps.getCurrentEmoteSet()}"`);

        const thinkingLevel = deps.pi.getThinkingLevel?.() ?? "high";
        const thinkingStyler = (theme as any).getThinkingBorderColor?.(thinkingLevel)
          ?? ((s: string) => theme.fg("border", s));
        const borderColor = colorStyler(config.theme.border ?? "thinking-level-color", thinkingStyler, theme);
        const separatorColor = colorStyler(config.theme["vertical-separator"] ?? "thinking-level-color", thinkingStyler, theme);
        const border = borderColor("─".repeat(width));
        const avatarWidth = frame.kind === "text" ? TEXT_CANVAS_COLS : config.size;
        const infoLines = buildInfoLines(width, avatarWidth, deps.getCtxRef(), deps.pi, theme, config);

        const lines: string[] = [];
        lines.push(border);

        if (frame.kind === "image") {
          if (frame.cursorAdvances) {
            lines.push(...renderITermFrame(frame, width, config, infoLines, separatorColor));
          } else {
            lines.push(...renderKittyFrame(frame, width, config, infoLines, separatorColor));
          }
        } else if (frame.kind === "placeholder") {
          lines.push(...renderPlaceholderFrame(frame, width, config, infoLines, separatorColor));
        } else {
          lines.push(...renderTextFrame(frame, width, config, infoLines, separatorColor));
        }

        return lines;
      },
      invalidate() {},
      dispose() {
        deps.animator.setTui(null);
      },
    };
  };
}
