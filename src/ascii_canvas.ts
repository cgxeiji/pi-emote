import type { AsciiCanvas } from "./types.js";

/**
 * The ASCII renderer draws into a fixed text box: every frame is centred
 * inside it and the widget always reserves the whole box, so the footer keeps
 * a stable height while the avatar animates.
 *
 * The default is a pixel-art avatar rendered with half blocks — 8 columns by
 * 4 rows, i.e. an 8x8 pixel grid — which is what the bundled emote sets are
 * drawn for. Raise it for a more detailed avatar, at the cost of a taller
 * footer.
 */
export const DEFAULT_ASCII_CANVAS: AsciiCanvas = { cols: 8, rows: 4 };

/** Larger than this is almost certainly a typo, and would wreck the footer. */
export const MAX_CANVAS_DIMENSION = 200;

function toDimension(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_CANVAS_DIMENSION) return null;
  return value;
}

/**
 * Validate a user-provided canvas.
 *
 * Each dimension falls back to its default on its own, so a typo in one of
 * them does not silently throw away the other. Returns the warning to report
 * rather than throwing: a bad value should degrade the layout, not break the
 * extension.
 */
export function sanitizeAsciiCanvas(value: unknown): { canvas: AsciiCanvas; warning: string | null } {
  const canvas: AsciiCanvas = { ...DEFAULT_ASCII_CANVAS };
  if (value === undefined || value === null) return { canvas, warning: null };

  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      canvas,
      warning: `"asciiCanvas" must be an object like {"cols": ${DEFAULT_ASCII_CANVAS.cols}, "rows": ${DEFAULT_ASCII_CANVAS.rows}}; using the default canvas`,
    };
  }

  const raw = value as Record<string, unknown>;
  const invalid: string[] = [];

  for (const key of ["cols", "rows"] as const) {
    if (raw[key] === undefined) continue;
    const parsed = toDimension(raw[key]);
    if (parsed === null) {
      invalid.push(`${key}=${JSON.stringify(raw[key])}`);
      continue;
    }
    canvas[key] = parsed;
  }

  const warning =
    invalid.length > 0
      ? `"asciiCanvas": ignoring ${invalid.join(", ")} (expected an integer between 1 and ${MAX_CANVAS_DIMENSION}); using the default for those keys`
      : null;

  return { canvas, warning };
}
