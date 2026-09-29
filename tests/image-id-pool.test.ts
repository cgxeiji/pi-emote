import { test } from "node:test";
import assert from "node:assert/strict";
import { ImageIdPool } from "../src/image_id_pool.ts";

test("consecutive ids never repeat within a full cycle", () => {
  const pool = new ImageIdPool(8);
  const ids = Array.from({ length: 8 }, () => pool.next());
  assert.equal(new Set(ids).size, 8, "every id of the pool must be used once per cycle");
  assert.equal(pool.next(), ids[0], "the cycle must start over");
});

test("a redraw never reuses the id of the image on screen", () => {
  // This is the property that matters: the protocol deletes an image and all its
  // placements as soon as new data is transmitted for the same id, so two
  // consecutive draws must always use different ids.
  const pool = new ImageIdPool(2);
  let previous = pool.next();
  for (let i = 0; i < 50; i++) {
    const id = pool.next();
    assert.notEqual(id, previous);
    previous = id;
  }
});

test("ids are non-zero 24-bit values and all() lists the whole pool", () => {
  const pool = new ImageIdPool(8);
  const all = pool.all();
  assert.equal(all.length, 8);
  for (const id of all) {
    assert.ok(Number.isInteger(id), `id ${id} is not an integer`);
    assert.ok(id >= 1 && id <= 0xffffff, `id ${id} is outside the 24-bit range`);
  }

  // every id the pool hands out comes from all(), which dispose() relies on
  const handed = new Set(Array.from({ length: 16 }, () => pool.next()));
  assert.deepEqual([...handed].sort((a, b) => a - b), [...all].sort((a, b) => a - b));
});

test("a pool needs at least two ids", () => {
  assert.throws(() => new ImageIdPool(1), RangeError);
  assert.throws(() => new ImageIdPool(0), RangeError);
});
