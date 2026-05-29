import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TUI } from "@earendil-works/pi-tui";
import type { EmoteState, EmotesConfig } from "./types.js";
import type { Renderer, RenderedFrame } from "./renderer.js";
import { log } from "./log.js";

// --- Minimal YAML parser for ascii.yaml ---
// Handles: scalars, one-level maps, and arrays of scalars. No YAML library needed.

interface AsciiFrameMap {
  [state: string]: string | string[] | Record<string, string>;
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  const unquoted = trimmed.replace(/^["']|["']$/g, "");
  return unquoted.replace(/\\n/g, "\n");
}

function parseSimpleYaml(text: string): AsciiFrameMap {
  const result: AsciiFrameMap = {};
  let currentKey: string | null = null;
  let currentObj: Record<string, string> | null = null;
  let currentArr: string[] | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");

    // Skip blank lines and comments
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;

    // Top-level key (no indent)
    const topMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (topMatch) {
      // Flush previous
      if (currentKey !== null) {
        if (currentArr) result[currentKey] = currentArr;
        else if (currentObj) result[currentKey] = currentObj;
      }
      currentKey = topMatch[1];
      currentArr = null;
      currentObj = null;
      const value = parseScalar(topMatch[2]);
      if (value) {
        // Inline scalar
        result[currentKey] = value;
        currentKey = null;
      }
      continue;
    }

    if (currentKey === null) continue;

    // Array item (  - "value")
    const arrMatch = line.match(/^\s+-\s+(.+)/);
    if (arrMatch) {
      if (!currentArr) currentArr = [];
      currentArr.push(parseScalar(arrMatch[1]));
      continue;
    }

    // Nested key (  key: "value")
    const nestedMatch = line.match(/^\s+(\w[\w-]*):\s+(.+)/);
    if (nestedMatch) {
      if (!currentObj) currentObj = {};
      currentObj[nestedMatch[1]] = parseScalar(nestedMatch[2]);
      continue;
    }
  }

  // Flush last
  if (currentKey !== null) {
    if (currentArr) result[currentKey] = currentArr;
    else if (currentObj) result[currentKey] = currentObj;
  }

  return result;
}

// --- ASCII frame storage ---

interface AsciiFrameSet {
  /** Named frames (for states like idle, think, talk). */
  named: Map<string, string>;
  /** Ordered list of frame names (for cycling and random pick). */
  names: string[];
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Text-based renderer for terminals without image protocol support.
 * Loads frames from ascii.yaml in the resolved emote set directory.
 */
export class AsciiRenderer implements Renderer {
  private tuiRef: TUI | null = null;
  private frames: Map<EmoteState, AsciiFrameSet> = new Map();
  private currentFrame: RenderedFrame | null = null;
  private lastShown: string | null = null;

  setTui(tui: TUI | null) {
    this.tuiRef = tui;
  }

  loadFrames(emoteSetDir: string, extDir: string) {
    // Look for ascii.yaml in the resolved emote set directory, fall back to shipped default
    const candidates = [
      ...(emoteSetDir ? [join(emoteSetDir, "ascii.yaml")] : []),
      join(extDir, "emotes", "ascii", "ascii.yaml"),
    ];

    let yamlText: string | null = null;
    for (const path of candidates) {
      if (existsSync(path)) {
        yamlText = readFileSync(path, "utf-8");
        log(`AsciiRenderer: loaded ${path}`);
        break;
      }
    }

    if (!yamlText) {
      log(`AsciiRenderer: no ascii.yaml found`);
      return;
    }

    const parsed = parseSimpleYaml(yamlText);
    this.frames.clear();

    const states: EmoteState[] = ["hi", "idle", "think", "talk", "read", "write", "tool", "success", "failure", "compact"];

    for (const state of states) {
      const value = parsed[state];
      if (value === undefined) continue;

      const named = new Map<string, string>();
      const names: string[] = [];

      if (typeof value === "string") {
        // Single frame — store as "default"
        named.set("default", value);
        names.push("default");
      } else if (Array.isArray(value)) {
        // Array of frames — index-named
        for (let i = 0; i < value.length; i++) {
          const name = `frame_${i}`;
          named.set(name, value[i]);
          names.push(name);
        }
      } else {
        // Named frames
        for (const [name, text] of Object.entries(value)) {
          named.set(name, text);
          names.push(name);
        }
      }

      this.frames.set(state, { named, names });
    }

    log(`AsciiRenderer: loaded ${this.frames.size} states`);
  }

  getRenderedFrame(): RenderedFrame | null {
    return this.currentFrame;
  }

  private show(text: string, force = false): boolean {
    if (!force && text === this.lastShown) return true;
    this.lastShown = text;
    this.currentFrame = { kind: "text", lines: text.split("\n") };
    this.tuiRef?.requestRender();
    return true;
  }

  showFrame(state: EmoteState, name: string, force = false): boolean {
    const frameSet = this.frames.get(state);
    if (!frameSet) return false;

    // Try exact match first
    let text = frameSet.named.get(name);
    if (!text) {
      // Strip .png extension (e.g. "idle.png" → "idle")
      const bare = name.replace(/\.png$/, "");
      text = frameSet.named.get(bare);
      // Map image naming conventions to YAML keys:
      //   idle.png / think.png → "default"
      //   idle_blink.png       → "blink"
      //   think_hard.png       → "hard"
      if (!text && bare === state) text = frameSet.named.get("default");
      if (!text) {
        const suffix = bare.replace(`${state}_`, "");
        if (suffix !== bare) text = frameSet.named.get(suffix);
      }
    }
    if (!text) return false;
    return this.show(text, force);
  }

  showRandomFrame(state: EmoteState, force = false): boolean {
    const frameSet = this.frames.get(state);
    if (!frameSet || frameSet.names.length === 0) return false;
    const name = randomPick(frameSet.names);
    const text = frameSet.named.get(name)!;
    return this.show(text, force);
  }

  showTalkFrame(_emotesConfig: EmotesConfig): boolean {
    const frameSet = this.frames.get("talk");
    if (!frameSet || frameSet.names.length === 0) return false;
    // Exclude "close" from random talk frames
    const candidates = frameSet.names.filter((n) => n !== "close");
    if (candidates.length === 0) return this.showRandomFrame("talk");
    const name = randomPick(candidates);
    return this.show(frameSet.named.get(name)!);
  }

  showTalkCloseFrame(): boolean {
    const frameSet = this.frames.get("talk");
    if (!frameSet) return false;
    const text = frameSet.named.get("close") ?? frameSet.named.get(frameSet.names[0]!)!;
    return this.show(text);
  }

  showCycleFrame(state: EmoteState, index: number): boolean {
    const frameSet = this.frames.get(state);
    if (!frameSet || frameSet.names.length === 0) return false;
    const name = frameSet.names[index % frameSet.names.length]!;
    return this.show(frameSet.named.get(name)!);
  }

  getCycleFrameCount(state: EmoteState): number {
    return this.frames.get(state)?.names.length ?? 0;
  }

  dispose() {
    this.currentFrame = null;
  }

  resetCache() {
    this.lastShown = null;
  }
}
