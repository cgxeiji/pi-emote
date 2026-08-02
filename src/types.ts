export type EmoteState = "hi" | "idle" | "think" | "talk" | "read" | "write" | "tool" | "success" | "failure" | "compact";

export type ThemeColor =
  | "accent" | "border" | "borderAccent" | "borderMuted"
  | "success" | "error" | "warning" | "muted" | "dim" | "text" | "thinkingText"
  | "userMessageText" | "customMessageText" | "customMessageLabel"
  | "toolTitle" | "toolOutput"
  | "mdHeading" | "mdLink" | "mdLinkUrl" | "mdCode" | "mdCodeBlock" | "mdCodeBlockBorder"
  | "mdQuote" | "mdQuoteBorder" | "mdHr" | "mdListBullet"
  | "toolDiffAdded" | "toolDiffRemoved" | "toolDiffContext"
  | "syntaxComment" | "syntaxKeyword" | "syntaxFunction" | "syntaxVariable" | "syntaxString"
  | "syntaxNumber" | "syntaxType" | "syntaxOperator" | "syntaxPunctuation"
  | "thinkingOff" | "thinkingMinimal" | "thinkingLow" | "thinkingMedium"
  | "thinkingHigh" | "thinkingXhigh" | "thinkingMax" | "bashMode";

/** A widget color: a pi theme token or the special "thinking-level-color" flag. */
export type WidgetColor = ThemeColor | "thinking-level-color";

export interface ProgressBarTheme {
  default?: WidgetColor;
  "cache-hit"?: WidgetColor;
  "cache-miss"?: WidgetColor;
  "almost-full"?: WidgetColor;
}

export interface WidgetTheme {
  "model-name"?: WidgetColor;
  "progress-bar"?: ProgressBarTheme;
  "token-info"?: WidgetColor;
  "working-directory"?: WidgetColor;
  border?: WidgetColor;
  "vertical-separator"?: WidgetColor;
}

export interface Config {
  enabled: boolean;
  debug: boolean;
  size: number;
  readingSpeed: number;
  hideBelow: number;
  holdDuration: { hi: number; success: number; failure: number };
  blinkInterval: [number, number];
  talkTickMs: number;
  cycleMs: number;
  emotes: EmoteMapping[];
  terminals: TerminalMapping[];
  theme: WidgetTheme;
}

export interface EmoteMapping {
  model?: string;
  "thinking-level"?: string;
  "emote-set": string;
}

export interface TerminalMapping {
  match: string;
  render: "kitty" | "kitty-unicode" | "iterm2" | "ascii" | "auto";
}

export interface ResolvedRenderer {
  protocol: "kitty" | "kitty-unicode" | "iterm2" | "ascii";
  multiplexer: "tmux" | "screen" | "zellij" | null;
  warning: string | null;
  warningLevel: "warning" | "info";
}

export interface EmotesConfig {
  idle?: { default?: string; blink?: string };
  think?: { default?: string; hard?: string };
  talk?: { weights?: Record<string, number> };
}

export interface FrameSet {
  files: string[];
  base64Cache: Map<string, string>;
}
