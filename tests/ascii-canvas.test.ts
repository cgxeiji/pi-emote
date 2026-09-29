import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeAsciiCanvas,
  DEFAULT_ASCII_CANVAS,
  MAX_CANVAS_DIMENSION,
} from "../src/ascii_canvas.ts";

test("no asciiCanvas configured → default canvas, no warning", () => {
  assert.deepEqual(sanitizeAsciiCanvas(undefined), { canvas: { cols: 8, rows: 4 }, warning: null });
  assert.deepEqual(sanitizeAsciiCanvas(null), { canvas: { cols: 8, rows: 4 }, warning: null });
  assert.deepEqual(sanitizeAsciiCanvas(DEFAULT_ASCII_CANVAS), {
    canvas: { cols: 8, rows: 4 },
    warning: null,
  });
});

test("a valid canvas is accepted unchanged", () => {
  const result = sanitizeAsciiCanvas({ cols: 24, rows: 12 });
  assert.deepEqual(result.canvas, { cols: 24, rows: 12 });
  assert.equal(result.warning, null);
});

test("omitted dimensions keep their default", () => {
  assert.deepEqual(sanitizeAsciiCanvas({ cols: 24 }).canvas, { cols: 24, rows: 4 });
  assert.deepEqual(sanitizeAsciiCanvas({ rows: 12 }).canvas, { cols: 8, rows: 12 });
  assert.deepEqual(sanitizeAsciiCanvas({}).canvas, { cols: 8, rows: 4 });
});

test("a bad dimension falls back on its own, keeping the other one", () => {
  // The point of validating per key: a typo in one dimension should not throw
  // away the other one, nor the whole canvas.
  const result = sanitizeAsciiCanvas({ cols: 24, rows: "12" });
  assert.deepEqual(result.canvas, { cols: 24, rows: 4 });
  assert.ok(result.warning !== null);
  assert.match(result.warning, /rows/);
  assert.doesNotMatch(result.warning, /cols=/);
});

test("rejects non-integers, zero, negatives and absurd sizes", () => {
  const bad = [0, -1, 1.5, NaN, Infinity, "8", true, [8], { n: 8 }, null];
  for (const value of bad) {
    const result = sanitizeAsciiCanvas({ cols: value });
    assert.deepEqual(result.canvas, { cols: 8, rows: 4 }, `cols=${JSON.stringify(value)} must be rejected`);
    assert.ok(result.warning !== null, `cols=${JSON.stringify(value)} must warn`);
  }

  // the upper bound is inclusive
  assert.equal(sanitizeAsciiCanvas({ cols: MAX_CANVAS_DIMENSION }).warning, null);
  assert.ok(sanitizeAsciiCanvas({ cols: MAX_CANVAS_DIMENSION + 1 }).warning !== null);
});

test("a canvas that is not an object is rejected as a whole", () => {
  for (const value of ["24x12", 12, [], true]) {
    const result = sanitizeAsciiCanvas(value);
    assert.deepEqual(result.canvas, { cols: 8, rows: 4 });
    assert.ok(result.warning !== null);
  }
});

test("the exported default is never mutated", () => {
  sanitizeAsciiCanvas({ cols: 24, rows: 12 });
  assert.deepEqual(DEFAULT_ASCII_CANVAS, { cols: 8, rows: 4 });
});
