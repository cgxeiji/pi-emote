import type { ProgressBarTheme, ThemeColor, WidgetColor, WidgetTheme } from "./types.js";

/** Full list of pi theme color tokens (mirrors pi's ThemeColor union). */
export const THEME_COLORS: readonly ThemeColor[] = [
  "accent", "border", "borderAccent", "borderMuted",
  "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "userMessageText", "customMessageText", "customMessageLabel",
  "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder",
  "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
  "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax", "bashMode",
];

export function isValidWidgetColor(value: unknown): value is WidgetColor {
  return value === "thinking-level-color"
    || (typeof value === "string" && (THEME_COLORS as readonly string[]).includes(value));
}

/**
 * Resolve the progress-bar color from the current context state.
 * Priority: cache-miss > almost-full > cache-hit > default.
 *
 * - cache-miss: 0% < cache hit rate < 50%
 * - almost-full: context fill >= 75%
 * - cache-hit: cache hit rate >= 50%
 * - default: cache hit rate == 0% (fresh session, no cache data yet)
 */
export function resolveProgressColor(
  percent: number,
  cacheHitRate: number,
  pb: ProgressBarTheme,
): WidgetColor {
  if (cacheHitRate > 0 && cacheHitRate < 50) return pb["cache-miss"] ?? "error";
  if (percent >= 75) return pb["almost-full"] ?? "warning";
  if (cacheHitRate >= 50) return pb["cache-hit"] ?? "success";
  return pb["default"] ?? "text";
}

export const DEFAULT_WIDGET_THEME: WidgetTheme = {
  "model-name": "thinking-level-color",
  "progress-bar": {
    default: "text",
    "cache-hit": "success",
    "cache-miss": "error",
    "almost-full": "warning",
  },
  "token-info": "dim",
  "working-directory": "warning",
  border: "thinking-level-color",
  "vertical-separator": "thinking-level-color",
};

/**
 * Validate a merged widget theme: warn and fall back to defaults for
 * invalid values or shapes. Returns a fully-populated theme.
 */
export function sanitizeWidgetTheme(theme: unknown): WidgetTheme {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
    if (theme !== undefined) {
      console.error(`[pi-emote] Warning: invalid "theme" config, using defaults.`);
    }
    return { ...DEFAULT_WIDGET_THEME };
  }

  const t = theme as Record<string, unknown>;
  const cleanColor = (slot: string, value: unknown, fallback: WidgetColor): WidgetColor => {
    if (isValidWidgetColor(value)) return value;
    if (value !== undefined) {
      console.error(`[pi-emote] Warning: invalid theme value "${String(value)}" for "${slot}", using default.`);
    }
    return fallback;
  };

  const pb = t["progress-bar"];
  let progressBar: ProgressBarTheme;
  if (pb && typeof pb === "object" && !Array.isArray(pb)) {
    const p = pb as Record<string, unknown>;
    progressBar = {
      default: cleanColor("progress-bar.default", p.default, DEFAULT_WIDGET_THEME["progress-bar"]!.default!),
      "cache-hit": cleanColor("progress-bar.cache-hit", p["cache-hit"], DEFAULT_WIDGET_THEME["progress-bar"]!["cache-hit"]!),
      "cache-miss": cleanColor("progress-bar.cache-miss", p["cache-miss"], DEFAULT_WIDGET_THEME["progress-bar"]!["cache-miss"]!),
      "almost-full": cleanColor("progress-bar.almost-full", p["almost-full"], DEFAULT_WIDGET_THEME["progress-bar"]!["almost-full"]!),
    };
  } else {
    if (pb !== undefined) {
      console.error(`[pi-emote] Warning: invalid "progress-bar" theme config, using defaults.`);
    }
    progressBar = { ...DEFAULT_WIDGET_THEME["progress-bar"]! };
  }

  return {
    "model-name": cleanColor("model-name", t["model-name"], DEFAULT_WIDGET_THEME["model-name"]!),
    "progress-bar": progressBar,
    "token-info": cleanColor("token-info", t["token-info"], DEFAULT_WIDGET_THEME["token-info"]!),
    "working-directory": cleanColor("working-directory", t["working-directory"], DEFAULT_WIDGET_THEME["working-directory"]!),
    border: cleanColor("border", t["border"], DEFAULT_WIDGET_THEME["border"]!),
    "vertical-separator": cleanColor("vertical-separator", t["vertical-separator"], DEFAULT_WIDGET_THEME["vertical-separator"]!),
  };
}
