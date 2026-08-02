import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEmoteSet } from "../src/emotes.ts";

test("model-only entries behave like main (thinking level defaults to *)", () => {
  const cfg = [{ model: "*claude*", "emote-set": "my-avatar" }];
  assert.equal(resolveEmoteSet("claude-opus", "off", cfg), "my-avatar");
  assert.equal(resolveEmoteSet("claude-opus", "high", cfg), "my-avatar");
  assert.equal(resolveEmoteSet("gpt-5", "high", cfg), "default");
});

test("thinking-level-only entries route by level for any model", () => {
  const cfg = [{ "thinking-level": "high", "emote-set": "focused" }];
  assert.equal(resolveEmoteSet("claude-opus", "high", cfg), "focused");
  assert.equal(resolveEmoteSet("gpt-5", "high", cfg), "focused");
  assert.equal(resolveEmoteSet("claude-opus", "medium", cfg), "default");
});

test("combined entries require both selectors to match", () => {
  const cfg = [{ model: "*claude*", "thinking-level": "high", "emote-set": "deep-focus" }];
  assert.equal(resolveEmoteSet("claude-opus", "high", cfg), "deep-focus");
  assert.equal(resolveEmoteSet("gpt-5", "high", cfg), "default");
  assert.equal(resolveEmoteSet("claude-opus", "medium", cfg), "default");
});

test("last match wins across dimensions (ordering decides layering)", () => {
  const levelLast = [
    { model: "*claude*", "emote-set": "my-avatar" },
    { "thinking-level": "high", "emote-set": "focused" },
  ];
  assert.equal(resolveEmoteSet("claude-opus", "high", levelLast), "focused");
  assert.equal(resolveEmoteSet("claude-opus", "low", levelLast), "my-avatar");

  const modelLast = [
    { "thinking-level": "high", "emote-set": "focused" },
    { model: "*claude*", "emote-set": "my-avatar" },
  ];
  assert.equal(resolveEmoteSet("claude-opus", "high", modelLast), "my-avatar");
});

test("entry with no selectors is a global catch-all", () => {
  const cfg = [{ "emote-set": "everything" }];
  assert.equal(resolveEmoteSet("any-model", "any-level", cfg), "everything");
});

test("matches are case-insensitive", () => {
  const cfg = [{ model: "*CLAUDE*", "emote-set": "my-avatar" }];
  assert.equal(resolveEmoteSet("claude-opus", "high", cfg), "my-avatar");
});

test("falls back to default when nothing matches", () => {
  assert.equal(resolveEmoteSet("gpt-5", "high", [{ model: "*claude*", "emote-set": "x" }]), "default");
});

test("warns only on same-dimension duplicate matches", (t) => {
  const calls: string[] = [];
  t.mock.method(console, "error", (msg?: unknown) => { calls.push(String(msg)); });

  // Two model patterns both match → warn
  resolveEmoteSet("claude-opus", "high", [
    { model: "*claude*", "emote-set": "a" },
    { model: "*opus*", "emote-set": "b" },
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /multiple model patterns/);

  // Two thinking-level patterns both match → warn
  calls.length = 0;
  resolveEmoteSet("claude-opus", "high", [
    { "thinking-level": "high", "emote-set": "a" },
    { "thinking-level": "*high*", "emote-set": "b" },
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /multiple thinking-level patterns/);

  // Model + thinking-level overlap is layering, not ambiguity → silent
  calls.length = 0;
  resolveEmoteSet("claude-opus", "high", [
    { model: "*claude*", "emote-set": "a" },
    { "thinking-level": "high", "emote-set": "b" },
  ]);
  assert.equal(calls.length, 0);

  // Catch-all "*" entries never count toward warnings
  calls.length = 0;
  resolveEmoteSet("claude-opus", "high", [
    { model: "*", "emote-set": "default" },
    { model: "*claude*", "emote-set": "a" },
  ]);
  assert.equal(calls.length, 0);
});
