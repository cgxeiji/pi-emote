import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProgressColor, sanitizeWidgetTheme, isValidWidgetColor, DEFAULT_WIDGET_THEME } from "../src/theme.ts";

test("progress-bar color priority: cache-miss > almost-full > cache-hit > default", () => {
  const pb = { default: "text", "cache-hit": "success", "cache-miss": "error", "almost-full": "warning" };

  // fresh session: no cache data yet → default
  assert.equal(resolveProgressColor(0, 0, pb), "text");
  assert.equal(resolveProgressColor(10, 0, pb), "text");

  // cache-hit: rate >= 50%
  assert.equal(resolveProgressColor(10, 50, pb), "success");
  assert.equal(resolveProgressColor(10, 90, pb), "success");
  assert.equal(resolveProgressColor(10, 100, pb), "success");

  // cache-miss: 0 < rate < 50%
  assert.equal(resolveProgressColor(10, 1, pb), "error");
  assert.equal(resolveProgressColor(10, 49.9, pb), "error");

  // almost-full: percent >= 75
  assert.equal(resolveProgressColor(75, 0, pb), "warning");
  assert.equal(resolveProgressColor(80, 0, pb), "warning");
  assert.equal(resolveProgressColor(74, 0, pb), "text");

  // almost-full + cache-hit → warning (almost-full wins on success)
  assert.equal(resolveProgressColor(80, 90, pb), "warning");
  assert.equal(resolveProgressColor(75, 50, pb), "warning");

  // almost-full + cache-miss → error (cache-miss wins)
  assert.equal(resolveProgressColor(80, 30, pb), "error");
  assert.equal(resolveProgressColor(100, 1, pb), "error");
});

test("progress-bar falls back to built-in defaults for missing sub-slots", () => {
  const pb = {};
  assert.equal(resolveProgressColor(10, 90, pb), "success");
  assert.equal(resolveProgressColor(10, 30, pb), "error");
  assert.equal(resolveProgressColor(90, 0, pb), "warning");
  assert.equal(resolveProgressColor(10, 0, pb), "text");
});

test("isValidWidgetColor accepts tokens and thinking-level-color, rejects junk", () => {
  assert.equal(isValidWidgetColor("accent"), true);
  assert.equal(isValidWidgetColor("thinkingHigh"), true);
  assert.equal(isValidWidgetColor("thinking-level-color"), true);
  assert.equal(isValidWidgetColor("not-a-color"), false);
  assert.equal(isValidWidgetColor("#ff0000"), false); // hex not supported
  assert.equal(isValidWidgetColor(42), false);
  assert.equal(isValidWidgetColor(undefined), false);
});

test("sanitizeWidgetTheme fills defaults for partial themes", () => {
  const theme = sanitizeWidgetTheme({ "model-name": "error" });
  assert.equal(theme["model-name"], "error");
  assert.equal(theme["token-info"], "dim");
  assert.equal(theme["working-directory"], "warning");
  assert.equal(theme.border, "thinking-level-color");
  assert.deepEqual(theme["progress-bar"], DEFAULT_WIDGET_THEME["progress-bar"]);
});

test("sanitizeWidgetTheme warns and falls back on invalid values", (t) => {
  const calls: string[] = [];
  t.mock.method(console, "error", (msg?: unknown) => { calls.push(String(msg)); });

  const theme = sanitizeWidgetTheme({
    "model-name": "bogus",
    "progress-bar": { "almost-full": "nope", "cache-hit": "success" },
    border: 123,
  });

  assert.equal(theme["model-name"], "thinking-level-color");
  assert.equal(theme["progress-bar"]?.["almost-full"], "warning");
  assert.equal(theme["progress-bar"]?.["cache-hit"], "success"); // valid sub-slot preserved
  assert.equal(theme.border, "thinking-level-color");
  assert.equal(calls.length, 3);
  assert.ok(calls.some((c) => c.includes('invalid theme value "bogus" for "model-name"')));
  assert.ok(calls.some((c) => c.includes('invalid theme value "nope" for "progress-bar.almost-full"')));
  assert.ok(calls.some((c) => c.includes('invalid theme value "123" for "border"')));
});

test("sanitizeWidgetTheme rejects wrong shapes with a warning", (t) => {
  const calls: string[] = [];
  t.mock.method(console, "error", (msg?: unknown) => { calls.push(String(msg)); });

  const theme = sanitizeWidgetTheme({ "progress-bar": "accent" });
  assert.deepEqual(theme["progress-bar"], DEFAULT_WIDGET_THEME["progress-bar"]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /invalid "progress-bar" theme config/);
});
