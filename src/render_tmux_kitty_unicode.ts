import { getCellDimensions, getImageDimensions, calculateImageRows } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import type { EmoteState, EmotesConfig, FrameSet } from "./types.js";
import type { Renderer, RenderedFrame } from "./renderer.js";
import { discoverFrames } from "./emotes.js";
import { wrapTmuxPassthrough } from "./tmux.js";
import { log } from "./log.js";
import { ImageIdPool } from "./image_id_pool.js";

const PLACEHOLDER = "\u{10EEEE}";
const CHUNK_SIZE = 4096;

/**
 * Row/column diacritics for kitty Unicode placeholders.
 * Derived from kitty's rowcolumn-diacritics.txt (combining class 230).
 * Index 0 = row 0, index 1 = row 1, etc.
 */
const ROW_DIACRITICS: string[] = [
  "\u0305", "\u030D", "\u030E", "\u0310", "\u0312",
  "\u033D", "\u033E", "\u033F", "\u0346", "\u034A",
  "\u034B", "\u034C", "\u0350", "\u0351", "\u0352",
  "\u0357", "\u035B", "\u0363", "\u0364", "\u0365",
  "\u0366", "\u0367", "\u0368", "\u0369", "\u036A",
  "\u036B", "\u036C", "\u036D", "\u036E", "\u036F",
  "\u0483", "\u0484", "\u0485", "\u0486", "\u0487",
  "\u0592", "\u0593", "\u0594", "\u0595", "\u0597",
  "\u0598", "\u0599", "\u059C", "\u059D", "\u059E",
  "\u059F", "\u05A0", "\u05A1", "\u05A8", "\u05A9",
  "\u05AB", "\u05AC", "\u05AF", "\u05C4", "\u0610",
  "\u0611", "\u0612", "\u0613", "\u0614", "\u0615",
  "\u0616", "\u0617", "\u0618", "\u0619", "\u061A",
  "\u0653", "\u0654", "\u0657", "\u0658", "\u06D6",
  "\u06D7", "\u06D8", "\u06D9", "\u06DA", "\u06DB",
  "\u06DC", "\u06DF", "\u06E0", "\u06E1", "\u06E2",
  "\u06E4", "\u06E7", "\u06E8", "\u06EB", "\u06EC",
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function weightedRandomPick(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [file, weight] of entries) {
    r -= weight;
    if (r <= 0) return file;
  }
  return entries[entries.length - 1]![0];
}

/**
 * Build the kitty graphics transmit sequence (with virtual placement U=1).
 * Handles chunking for large payloads. Wrapped in tmux passthrough.
 */
function buildTransmitSequence(base64: string, imageId: number, cols: number, rows: number): string {
  const chunks: string[] = [];
  let offset = 0;

  while (offset < base64.length) {
    const chunk = base64.slice(offset, offset + CHUNK_SIZE);
    const isFirst = offset === 0;
    const isLast = offset + CHUNK_SIZE >= base64.length;
    const more = isLast ? 0 : 1;

    if (isFirst) {
      const meta = `a=T,f=100,q=2,U=1,i=${imageId},c=${cols},r=${rows}`;
      chunks.push(`\x1b_G${meta},m=${more};${chunk}\x1b\\`);
    } else {
      chunks.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
    offset += CHUNK_SIZE;
  }

  if (chunks.length === 0) {
    chunks.push(`\x1b_Ga=T,f=100,q=2,U=1,i=${imageId},c=${cols},r=${rows},m=0;\x1b\\`);
  }

  return wrapTmuxPassthrough(chunks.join(""));
}

/**
 * Build the Unicode placeholder grid text for an image.
 * Each line is one row of placeholder characters colored with the image ID.
 */
function buildPlaceholderLines(imageId: number, cols: number, rows: number): string[] {
  const r = (imageId >> 16) & 255;
  const g = (imageId >> 8) & 255;
  const b = imageId & 255;
  const colorOn = `\x1b[38;2;${r};${g};${b}m`;
  const colorOff = `\x1b[39m`;

  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const diacritic = row < ROW_DIACRITICS.length ? ROW_DIACRITICS[row] : ROW_DIACRITICS[0];
    // First char gets row diacritic, rest inherit
    const firstChar = PLACEHOLDER + diacritic;
    const restChars = PLACEHOLDER.repeat(Math.max(0, cols - 1));
    lines.push(`${colorOn}${firstChar}${restChars}${colorOff}`);
  }
  return lines;
}

/**
 * Kitty Unicode Placeholder renderer for tmux.
 *
 * Uses kitty's virtual placement + Unicode placeholder approach:
 * 1. Transmit image data via DCS passthrough (creates virtual placement)
 * 2. Display via U+10EEEE placeholder characters (regular text)
 *
 * This makes the image behave like normal text — tmux constrains it to
 * the pane, and switching sessions clears it naturally.
 */
export class TmuxKittyUnicodeRenderer implements Renderer {
  private tuiRef: TUI | null = null;
  private frameMap: Map<EmoteState, FrameSet> = new Map();
  private lastShownBase64: string | null = null;
  private currentFrame: RenderedFrame | null = null;
  private size: number;
  private idPool: ImageIdPool;

  constructor(size: number) {
    this.size = size;
    this.idPool = new ImageIdPool();
  }

  setTui(tui: TUI | null) {
    this.tuiRef = tui;
  }

  loadFrames(emoteSetDir: string, _extDir: string) {
    this.frameMap = discoverFrames(emoteSetDir);
  }

  getRenderedFrame(): RenderedFrame | null {
    return this.currentFrame;
  }

  private show(base64: string, force = false): boolean {
    if (!force && base64 === this.lastShownBase64) return true;
    this.lastShownBase64 = base64;

    const dims = getImageDimensions(base64, "image/png") ?? { widthPx: 510, heightPx: 510 };
    const cellDims = getCellDimensions();
    const cols = this.size;
    const rows = calculateImageRows(dims, cols, cellDims);

    // Take a fresh id so the image currently on screen is never overwritten mid-transfer.
    const imageId = this.idPool.next();

    // Transmit image data via passthrough (uploads to terminal's image store)
    const transmit = buildTransmitSequence(base64, imageId, cols, rows);
    process.stdout.write(transmit);

    // Build placeholder grid as text lines
    const lines = buildPlaceholderLines(imageId, cols, rows);

    log(`TmuxKittyUnicodeRenderer.show: dims=${dims.widthPx}x${dims.heightPx}, cols=${cols}, rows=${rows}, imageId=${imageId}`);

    this.currentFrame = { kind: "placeholder", lines, rows };
    this.tuiRef?.requestRender();
    return true;
  }

  private getBase64(state: EmoteState, name: string): string | null {
    return this.frameMap.get(state)?.base64Cache.get(name) ?? null;
  }

  showFrame(state: EmoteState, name: string, force = false): boolean {
    const b64 = this.getBase64(state, name);
    if (!b64) return false;
    return this.show(b64, force);
  }

  showRandomFrame(state: EmoteState, force = false): boolean {
    const frameSet = this.frameMap.get(state);
    if (!frameSet || frameSet.files.length === 0) return false;
    const file = randomPick(frameSet.files);
    const b64 = frameSet.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64, force);
  }

  showTalkFrame(emotesConfig: EmotesConfig): boolean {
    const frameSet = this.frameMap.get("talk");
    if (!frameSet || frameSet.files.length === 0) return false;

    if (emotesConfig.talk?.weights) {
      const file = weightedRandomPick(emotesConfig.talk.weights);
      const b64 = frameSet.base64Cache.get(file);
      if (!b64) return this.showRandomFrame("talk");
      return this.show(b64);
    }
    return this.showRandomFrame("talk");
  }

  showTalkCloseFrame(): boolean {
    const frameSet = this.frameMap.get("talk");
    if (!frameSet) return false;
    const closeFile = frameSet.files.find((f) => f.includes("close"));
    const file = closeFile ?? frameSet.files[0]!;
    const b64 = frameSet.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64);
  }

  showCycleFrame(state: EmoteState, index: number): boolean {
    const frameSet = this.frameMap.get(state);
    if (!frameSet || frameSet.files.length === 0) return false;
    const file = frameSet.files[index % frameSet.files.length]!;
    const b64 = frameSet.base64Cache.get(file);
    if (!b64) return false;
    return this.show(b64);
  }

  getCycleFrameCount(state: EmoteState): number {
    return this.frameMap.get(state)?.files.length ?? 0;
  }

  dispose() {
    // Delete images from terminal's graphics memory
    for (const id of this.idPool.all()) {
      const del = `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`;
      process.stdout.write(wrapTmuxPassthrough(del));
    }
    this.currentFrame = null;
  }

  resetCache() {
    this.lastShownBase64 = null;
  }
}
