/**
 * Terminal identification from environment variables only.
 *
 * Kept free of runtime dependencies so it can be unit tested directly.
 */

/**
 * Detect the terminal or multiplexer name from environment variables.
 * Multiplexers are checked first — they set vars that leak through from
 * the outer terminal emulator.
 */
export function detectTerminalName(): string {
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  const term = (process.env.TERM ?? "").toLowerCase();

  // --- Multiplexers (checked first) ---
  if (process.env.ZELLIJ_SESSION_NAME || process.env.ZELLIJ) return "zellij";
  if (process.env.TMUX || term.startsWith("tmux")) return "tmux";
  if (term.startsWith("screen")) return "screen";

  // herdr runs panes under its own compositor but passes the outer terminal's
  // TERM_PROGRAM/GHOSTTY_RESOURCES_DIR straight through, so it has to be
  // checked before the emulator branches below or it is misread as its host.
  // It is not in MULTIPLEXERS because it needs no tmux-style DCS passthrough.
  if (process.env.HERDR_PANE_ID) return "herdr";

  // --- Terminal emulators ---
  if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") return "kitty";
  if (process.env.GHOSTTY_RESOURCES_DIR || termProgram === "ghostty" || term.includes("ghostty")) return "ghostty";
  if (process.env.WEZTERM_PANE || termProgram === "wezterm") return "wezterm";
  if (process.env.ITERM_SESSION_ID || termProgram === "iterm.app") return "iterm2";
  if (termProgram === "vscode") return "vscode";
  if (termProgram === "alacritty") return "alacritty";
  if (termProgram === "warpterminal") return "warpterminal";

  return "unknown";
}

