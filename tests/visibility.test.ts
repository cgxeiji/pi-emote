import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createWidgetVisibility, registerVisibilityCommand } from "../src/visibility.ts";

test("pi-emote-toggle hides and restores the widget for the current session", async () => {
  const transitions: string[] = [];
  const notices: string[] = [];
  const visibility = createWidgetVisibility({
    show: () => transitions.push("show"),
    hide: () => transitions.push("hide"),
  });

  let commandName = "";
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  registerVisibilityCommand({
    registerCommand(name: string, options: { handler: typeof handler }) {
      commandName = name;
      handler = options.handler;
    },
  } as unknown as ExtensionAPI, visibility);

  visibility.show();
  assert.equal(visibility.isVisible(), true);
  assert.deepEqual(transitions, ["show"]);
  assert.equal(commandName, "pi-emote-toggle");

  const ctx = {
    hasUI: true,
    ui: {
      notify(message: string) {
        notices.push(message);
      },
    },
  };

  await handler!("", ctx);
  assert.equal(visibility.isVisible(), false);
  assert.deepEqual(transitions, ["show", "hide"]);
  assert.equal(notices.at(-1), "[pi-emote] Widget hidden.");

  await handler!("", ctx);
  assert.equal(visibility.isVisible(), true);
  assert.deepEqual(transitions, ["show", "hide", "show"]);
  assert.equal(notices.at(-1), "[pi-emote] Widget shown.");
});

test("the visibility lifecycle is idempotent and ignores commands without a UI", async () => {
  const transitions: string[] = [];
  const visibility = createWidgetVisibility({
    show: () => transitions.push("show"),
    hide: () => transitions.push("hide"),
  });

  visibility.show();
  visibility.show();
  visibility.hide();
  visibility.hide();
  assert.deepEqual(transitions, ["show", "hide"]);

  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  registerVisibilityCommand({
    registerCommand(_name: string, options: { handler: typeof handler }) {
      handler = options.handler;
    },
  } as unknown as ExtensionAPI, visibility);

  await handler!("", { hasUI: false, ui: { notify() {} } });
  assert.equal(visibility.isVisible(), false);
  assert.deepEqual(transitions, ["show", "hide"]);
});
