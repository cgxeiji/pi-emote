import type { TUI } from "@earendil-works/pi-tui";
import type { EmoteState, Config, EmotesConfig } from "./types.js";
import type { Renderer, RenderedFrame } from "./renderer.js";

// --- Helpers ---

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// --- Animator ---

export class Animator {
  // State machine
  currentState: EmoteState = "idle";

  // Renderer
  private renderer: Renderer;
  private config: Config;
  private emotesConfig: EmotesConfig = {};

  // Timers
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private talkTimer: ReturnType<typeof setInterval> | null = null;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private thinkTimer: ReturnType<typeof setTimeout> | null = null;
  private talkGapTimer: ReturnType<typeof setTimeout> | null = null;
  private talkDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private frameTimers = new Set<ReturnType<typeof setTimeout>>();

  // Cycle state
  private cycleIndex = 0;
  private cycleDirection = 1;

  // Hold state
  private holdNextState: EmoteState = "idle";

  // Talk state
  private talkWordCount = 0;
  private talkStartTime = 0;
  private lastTokenTime = 0;
  private talkMouthClosed = false;

  constructor(config: Config, renderer: Renderer) {
    this.config = config;
    this.renderer = renderer;
  }

  updateConfig(config: Config) {
    this.config = config;
  }

  setRenderer(renderer: Renderer) {
    this.renderer = renderer;
  }

  setTui(tui: TUI | null) {
    this.renderer.setTui(tui);
  }

  setEmotesConfig(emotesConfig: EmotesConfig) {
    this.emotesConfig = emotesConfig;
  }

  setHoldNextState(state: EmoteState) {
    this.holdNextState = state;
  }

  /** Get current rendered frame for the widget. */
  getRenderedFrame(): RenderedFrame | null {
    return this.renderer.getRenderedFrame();
  }

  resetRenderCache() {
    this.renderer.resetCache();
  }

  disposeRenderer() {
    this.renderer.dispose();
  }

  // --- Timer management ---

  private scheduleFrameTimer(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      this.frameTimers.delete(timer);
      callback();
    }, delay);
    this.frameTimers.add(timer);
  }

  private clearFrameTimers() {
    for (const timer of this.frameTimers) clearTimeout(timer);
    this.frameTimers.clear();
  }

  clearAllTimers() {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.blinkTimer) { clearTimeout(this.blinkTimer); this.blinkTimer = null; }
    if (this.talkTimer) { clearInterval(this.talkTimer); this.talkTimer = null; }
    if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    this.clearFrameTimers();
  }

  private clearStateTimers() {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.talkTimer) { clearInterval(this.talkTimer); this.talkTimer = null; }
    if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    this.clearFrameTimers();
  }

  // --- State transitions ---

  transitionTo(state: EmoteState) {
    this.clearStateTimers();
    if (this.currentState === "idle" && this.blinkTimer) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    this.currentState = state;

    switch (state) {
      case "hi": this.enterHi(); break;
      case "idle": this.enterIdle(); break;
      case "think": this.enterThink(); break;
      case "talk": this.enterTalk(); break;
      case "read":
      case "write":
      case "tool": this.enterCycle(state); break;
      case "success": this.enterHold(state, this.config.holdDuration.success, this.holdNextState); this.holdNextState = "idle"; break;
      case "failure": this.enterHold(state, this.config.holdDuration.failure, this.holdNextState); this.holdNextState = "idle"; break;
      case "compact": this.enterCompact(); break;
    }
  }

  private enterHi() {
    this.renderer.showRandomFrame("hi");
    this.holdTimer = setTimeout(() => this.transitionTo("idle"), this.config.holdDuration.hi);
  }

  enterIdle() {
    const defaultFile = this.emotesConfig.idle?.default ?? "idle.png";
    this.renderer.showFrame("idle", defaultFile);
    this.scheduleBlink();
  }

  private scheduleBlink() {
    if (this.blinkTimer) { clearTimeout(this.blinkTimer); this.blinkTimer = null; }
    const delay = randomInRange(this.config.blinkInterval[0], this.config.blinkInterval[1]);
    this.blinkTimer = setTimeout(() => {
      if (this.currentState !== "idle") return;
      this.doBlink();
    }, delay);
  }

  private doBlink() {
    const blinkFile = this.emotesConfig.idle?.blink ?? "idle_blink.png";
    if (!this.renderer.showFrame("idle", blinkFile)) {
      this.scheduleBlink();
      return;
    }

    const doubleBlink = Math.random() < 0.15;
    const blinkDuration = 150;
    const defaultFile = this.emotesConfig.idle?.default ?? "idle.png";

    this.scheduleFrameTimer(() => {
      if (this.currentState !== "idle") return;
      this.renderer.showFrame("idle", defaultFile, true);

      if (doubleBlink) {
        this.scheduleFrameTimer(() => {
          if (this.currentState !== "idle") return;
          this.renderer.showFrame("idle", blinkFile, true);
          this.scheduleFrameTimer(() => {
            if (this.currentState !== "idle") return;
            this.renderer.showFrame("idle", defaultFile, true);
            this.scheduleBlink();
          }, blinkDuration);
        }, 100);
      } else {
        this.scheduleBlink();
      }
    }, blinkDuration);
  }

  private enterThink() {
    const defaultFile = this.emotesConfig.think?.default ?? "think.png";
    this.renderer.showFrame("think", defaultFile);
    this.scheduleThinkSwap();
  }

  private scheduleThinkSwap() {
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    const delay = randomInRange(this.config.blinkInterval[0], this.config.blinkInterval[1]);
    this.thinkTimer = setTimeout(() => {
      if (this.currentState !== "think") return;
      this.doThinkSwap();
    }, delay);
  }

  private doThinkSwap() {
    const hardFile = this.emotesConfig.think?.hard ?? "think_hard.png";
    if (!this.renderer.showFrame("think", hardFile, true)) {
      this.scheduleThinkSwap();
      return;
    }

    const defaultFile = this.emotesConfig.think?.default ?? "think.png";
    this.scheduleFrameTimer(() => {
      if (this.currentState !== "think") return;
      this.renderer.showFrame("think", defaultFile, true);
      this.scheduleThinkSwap();
    }, 800);
  }

  private enterTalk() {
    this.talkWordCount = 0;
    this.talkStartTime = Date.now();
    this.lastTokenTime = Date.now();
    this.talkMouthClosed = false;

    this.renderer.showTalkFrame(this.emotesConfig);

    this.talkTimer = setInterval(() => {
      if (this.currentState !== "talk") return;
      if (this.talkMouthClosed) {
        this.renderer.showTalkCloseFrame();
      } else {
        this.renderer.showTalkFrame(this.emotesConfig);
      }
    }, this.config.talkTickMs);
  }

  onTalkToken(text: string) {
    if (this.currentState !== "talk") return;

    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    this.talkWordCount += words;
    this.lastTokenTime = Date.now();

    if (this.talkMouthClosed) {
      this.talkMouthClosed = false;
    }

    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    this.talkGapTimer = setTimeout(() => {
      if (this.currentState !== "talk") return;
      this.talkMouthClosed = true;
    }, 200);

    this.recalculateTalkDuration();
  }

  private recalculateTalkDuration() {
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }

    const targetDurationMs = (this.talkWordCount / this.config.readingSpeed) * 1000;
    const elapsed = Date.now() - this.talkStartTime;
    const remaining = Math.max(0, targetDurationMs - elapsed);

    this.talkDurationTimer = setTimeout(() => {
      if (this.currentState !== "talk") return;
      const timeSinceLastToken = Date.now() - this.lastTokenTime;
      if (timeSinceLastToken > 200) {
        this.transitionTo("idle");
      } else {
        this.talkDurationTimer = setTimeout(() => {
          if (this.currentState === "talk") this.transitionTo("idle");
        }, 200);
      }
    }, remaining);
  }

  endTalk() {
    if (this.currentState !== "talk") return;
    const targetDurationMs = (this.talkWordCount / this.config.readingSpeed) * 1000;
    const elapsed = Date.now() - this.talkStartTime;
    if (elapsed >= targetDurationMs) {
      this.transitionTo("idle");
    } else {
      // Streaming finished but reading time remains — keep mouth animating
      if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
      this.talkMouthClosed = false;
    }
  }

  private enterCycle(state: EmoteState) {
    this.cycleIndex = 0;
    this.cycleDirection = 1;
    this.renderer.showCycleFrame(state, 0);

    const count = this.renderer.getCycleFrameCount(state);
    if (count <= 1) return;

    this.cycleTimer = setInterval(() => {
      if (this.currentState !== state) return;
      this.cycleIndex += this.cycleDirection;
      if (this.cycleIndex >= count - 1) this.cycleDirection = -1;
      if (this.cycleIndex <= 0) this.cycleDirection = 1;
      this.renderer.showCycleFrame(state, this.cycleIndex);
    }, this.config.cycleMs);
  }

  private enterHold(state: EmoteState, duration: number, nextState: EmoteState = "idle") {
    this.renderer.showRandomFrame(state);
    this.holdTimer = setTimeout(() => this.transitionTo(nextState), duration);
  }

  private enterCompact() {
    this.renderer.showRandomFrame("compact");
  }
}
