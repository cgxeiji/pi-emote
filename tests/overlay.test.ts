import { test } from "node:test";
import assert from "node:assert/strict";
import { createImageOverlayFactory } from "../src/overlay.ts";

function makeComponent(frame: any, width = 8, showInfo = false) {
  const calls: unknown[] = [];
  const animator = {
    setTui(value: unknown) { calls.push(value); },
    getRenderedFrame() { return frame; },
  } as any;
  const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value };
  const config = { size: width, showInfo, theme: {} } as any;
  const component = createImageOverlayFactory({
    animator,
    config,
    getInfoLines: (width: number, avatarWidth: number, activeTheme: any) =>
      showInfo ? ["no model", "⏵ progress", "stats", "~/project"] : [],
  })( { requestRender() {} }, theme);
  return { component, calls };
}

test("Kitty overlay contains only the image in its anchored avatar region", () => {
  const { component } = makeComponent({ kind: "image", sequence: "KITTY_IMAGE", rows: 3, cursorAdvances: false });
  const lines = component.render(8);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "KITTY_IMAGE");
  assert.equal(lines[1], " ".repeat(8));
  assert.equal(lines[2], " ".repeat(8));
});

test("iTerm overlay emits its image on the final row after moving to the top", () => {
  const { component } = makeComponent({ kind: "image", sequence: "ITERM_IMAGE", rows: 4, cursorAdvances: true });
  const lines = component.render(8);
  assert.deepEqual(lines, [" ".repeat(8), " ".repeat(8), " ".repeat(8), "\x1b[3AITERM_IMAGE"]);
});

test("text-only avatar frames remain compact and centered", () => {
  const { component } = makeComponent({ kind: "text", lines: ["abc", "12345678"] });
  assert.deepEqual(component.render(8), ["  abc   ", "12345678"]);
});

test("optional info lines share the overlay without replacing the avatar", () => {
  const { component } = makeComponent({ kind: "image", sequence: "KITTY_IMAGE", rows: 3, cursorAdvances: false }, 8, true);
  const lines = component.render(60);
  assert.equal(lines.length, 4);
  assert.match(lines[0]!, /no model/);
  assert.match(lines[0]!, /KITTY_IMAGE/);
  assert.match(lines[1]!, /⏵/);
});

test("component attaches and detaches the animator from the TUI", () => {
  const { component, calls } = makeComponent({ kind: "text", lines: ["x"] });
  const tui = calls[0];
  component.dispose();
  assert.deepEqual(calls, [tui, null]);
});
