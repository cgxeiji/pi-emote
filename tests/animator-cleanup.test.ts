import assert from "node:assert/strict";
import test from "node:test";

import { Animator } from "../src/animator.ts";
import type { Config, EmoteState, EmotesConfig } from "../src/types.ts";
import type { RenderedFrame, Renderer } from "../src/renderer.ts";

const config: Config = {
  enabled: true,
  debug: false,
  size: 8,
  readingSpeed: 4,
  hideBelow: 40,
  holdDuration: { hi: 2000, success: 1200, failure: 1200 },
  blinkInterval: [0, 0],
  talkTickMs: 120,
  cycleMs: 500,
  emotes: [],
  terminals: [],
  theme: {},
};

function createRendererSpy() {
  const calls: string[] = [];
  const renderer: Renderer = {
    setTui() {},
    loadFrames() {},
    getRenderedFrame(): RenderedFrame | null { return null; },
    showFrame(state: EmoteState, name: string) {
      calls.push(`${state}:${name}`);
      return true;
    },
    showRandomFrame(state: EmoteState) {
      calls.push(`${state}:random`);
      return true;
    },
    showTalkFrame(_emotesConfig: EmotesConfig) { return true; },
    showTalkCloseFrame() { return true; },
    showCycleFrame() { return true; },
    getCycleFrameCount() { return 0; },
    dispose() { calls.push("dispose"); },
    resetCache() {},
  };

  return { calls, renderer };
}

test("hiding during a blink cancels delayed frame changes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(Math, "random", () => 0.5);
  const { calls, renderer } = createRendererSpy();
  const animator = new Animator(config, renderer);

  animator.enterIdle();
  t.mock.timers.tick(0);
  assert.deepEqual(calls, ["idle:idle.png", "idle:idle_blink.png"]);

  animator.clearAllTimers();
  renderer.dispose();
  t.mock.timers.tick(1000);

  assert.deepEqual(calls, ["idle:idle.png", "idle:idle_blink.png", "dispose"]);
});

test("hiding during a think swap cancels its delayed frame change", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(Math, "random", () => 0.5);
  const { calls, renderer } = createRendererSpy();
  const animator = new Animator(config, renderer);

  animator.transitionTo("think");
  t.mock.timers.tick(0);
  assert.deepEqual(calls, ["think:think.png", "think:think_hard.png"]);

  animator.clearAllTimers();
  renderer.dispose();
  t.mock.timers.tick(1000);

  assert.deepEqual(calls, ["think:think.png", "think:think_hard.png", "dispose"]);
});
