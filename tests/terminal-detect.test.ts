import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { detectTerminalName } from "../src/detect_terminal.ts";

const TOUCHED = [
  "HERDR_PANE_ID",
  "TMUX",
  "TERM",
  "TERM_PROGRAM",
  "GHOSTTY_RESOURCES_DIR",
  "KITTY_WINDOW_ID",
  "ZELLIJ",
  "ZELLIJ_SESSION_NAME",
];

const saved = new Map(TOUCHED.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function only(env: Record<string, string>) {
  for (const k of TOUCHED) delete process.env[k];
  Object.assign(process.env, env);
}

test("herdr is detected even though it inherits the outer terminal's env", () => {
  // A herdr pane launched from Ghostty sees both of these, which is exactly
  // the case that used to resolve to "ghostty" and pick direct placement.
  only({
    HERDR_PANE_ID: "w1:p1",
    TERM: "xterm-256color",
    TERM_PROGRAM: "ghostty",
    GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app/Contents/Resources/ghostty",
  });
  assert.equal(detectTerminalName(), "herdr");
});

test("herdr wins over a leaked kitty identity too", () => {
  only({ HERDR_PANE_ID: "w2:p1", TERM: "xterm-kitty", KITTY_WINDOW_ID: "3" });
  assert.equal(detectTerminalName(), "herdr");
});

test("tmux inside herdr still resolves to tmux, so DCS passthrough is kept", () => {
  only({ HERDR_PANE_ID: "w1:p1", TMUX: "/tmp/tmux-501/default,123,0", TERM: "tmux-256color" });
  assert.equal(detectTerminalName(), "tmux");
});

test("plain ghostty is unaffected", () => {
  only({ TERM: "xterm-256color", TERM_PROGRAM: "ghostty" });
  assert.equal(detectTerminalName(), "ghostty");
});

test("unknown terminal stays unknown", () => {
  only({ TERM: "xterm-256color" });
  assert.equal(detectTerminalName(), "unknown");
});
