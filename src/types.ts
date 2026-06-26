export type EmoteState = "hi" | "idle" | "think" | "talk" | "read" | "write" | "tool" | "success" | "failure" | "compact";

export type ThemeColor = "accent" | "border" | "borderAccent" | "borderMuted" | "success" | "error" | "warning" | "muted" | "dim" | "text" | "thinkingText";

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
  colors?: {
    model?: ThemeColor;
    progress?: ThemeColor;
    stats?: ThemeColor;
    directory?: ThemeColor;
  };
}

export interface EmoteMapping {
  model: string;
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
