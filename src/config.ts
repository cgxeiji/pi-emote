import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config, EmoteMapping, TerminalMapping } from "./types.js";
import { DEFAULT_WIDGET_THEME, sanitizeWidgetTheme } from "./theme.js";

export interface ConfigResult {
  config: Config;
  userConfiguredTerminals: Set<string>;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function loadJsonFile(path: string): any | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

const DEFAULTS: Config = {
  enabled: true,
  debug: false,
  size: 8,
  readingSpeed: 4,
  hideBelow: 40,
  holdDuration: { hi: 2000, success: 1200, failure: 1200 },
  blinkInterval: [3000, 6000],
  talkTickMs: 120,
  cycleMs: 500,
  emotes: [{ model: "*", "emote-set": "default" }],
  terminals: [
    { match: "zellij", render: "ascii" },
    { match: "tmux", render: "auto" },
    { match: "screen", render: "ascii" },
    { match: "wezterm", render: "iterm2" },
    { match: "ghostty", render: "kitty" },
    { match: "warpterminal", render: "kitty" },
  ],
  theme: { ...DEFAULT_WIDGET_THEME },
};

/**
 * Append emote arrays in priority order.
 * Since emotes uses "last match wins", lower-priority layers come first.
 * Skips undefined/empty layers — they don't participate.
 */
function mergeEmotes(...layers: (EmoteMapping[] | undefined)[]): EmoteMapping[] {
  const result: EmoteMapping[] = [];
  for (const layer of layers) {
    if (layer?.length) result.push(...layer);
  }
  return result.length > 0 ? result : DEFAULTS.emotes;
}

/**
 * Merge terminal arrays by `match` key.
 * Higher-priority layers replace entries with the same match key,
 * or append new ones. Preserves ordering from lower layers.
 */
function mergeTerminals(...layers: (TerminalMapping[] | undefined)[]): TerminalMapping[] {
  const result = new Map<string, TerminalMapping>();
  for (const layer of layers) {
    if (!layer?.length) continue;
    for (const entry of layer) {
      result.set(entry.match, entry);
    }
  }
  return result.size > 0 ? [...result.values()] : DEFAULTS.terminals;
}

export function loadLayeredConfig(extDir: string, cwd: string): ConfigResult {
  // Layer 1: Extension config (lowest priority)
  const extConfig = loadJsonFile(join(extDir, "config.json"));

  // Layer 2: User global config
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const userConfig = loadJsonFile(join(homeDir, ".pi", "agent", "extensions", "pi-emote", "config.json"));

  // Layer 3: Project config (highest priority)
  const projectConfig = loadJsonFile(join(cwd, ".pi", "extensions", "pi-emote", "config.json"));

  // Deep merge in priority order
  let merged = DEFAULTS;
  if (extConfig) merged = deepMerge(merged, extConfig);
  if (userConfig) merged = deepMerge(merged, userConfig);
  if (projectConfig) merged = deepMerge(merged, projectConfig);

  // "emotes" — append arrays in priority order (last match wins)
  merged.emotes = mergeEmotes(
    DEFAULTS.emotes,
    extConfig?.emotes,
    userConfig?.emotes,
    projectConfig?.emotes,
  );

  // "terminals" — merge by match key, higher priority replaces (first match wins)
  merged.terminals = mergeTerminals(
    DEFAULTS.terminals,
    extConfig?.terminals,
    userConfig?.terminals,
    projectConfig?.terminals,
  );

  // "theme" — deep-merged above, then validated: warn + fall back to defaults
  merged.theme = sanitizeWidgetTheme(merged.theme);

  // Track which terminal match keys were explicitly set by user or project config
  const userConfiguredTerminals = new Set<string>();
  for (const entry of userConfig?.terminals ?? []) {
    userConfiguredTerminals.add(entry.match);
  }
  for (const entry of projectConfig?.terminals ?? []) {
    userConfiguredTerminals.add(entry.match);
  }

  return { config: merged, userConfiguredTerminals };
}
