"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CropTools: crop } = require("../static/crop.js");

test("default square is centered in the original image", () => {
  assert.deepEqual(crop.centered(400, 200), { x: 100, y: 0, width: 200, height: 200 });
  assert.deepEqual(crop.centered(200, 400), { x: 0, y: 100, width: 200, height: 200 });
  assert.deepEqual(crop.centered(400, 200, false), { x: 0, y: 0, width: 400, height: 200 });
});
test("moving clamps to image bounds without resizing the crop", () => {
  const rect = { x: 100, y: 50, width: 100, height: 80 };
  assert.deepEqual(crop.move(rect, -999, 999, 400, 200), { x: 0, y: 120, width: 100, height: 80 });
  assert.equal(rect.x, 100);
});
test("drawing backwards and out of bounds yields a valid square in pixel space", () => {
  const rect = crop.draw({ x: 300, y: 180 }, { x: -20, y: 20 }, 400, 200, true);
  assert.deepEqual(rect, { x: 140, y: 20, width: 160, height: 160 });
});
test("freeform drawing and each corner resize retain the opposite corner", () => {
  assert.deepEqual(crop.draw({ x: 20, y: 30 }, { x: 90, y: 70 }, 400, 200, false), { x: 20, y: 30, width: 70, height: 40 });
  const rect = { x: 100, y: 50, width: 100, height: 100 };
  for (const [handle, point, expected] of [
    ["nw", { x: 80, y: 30 }, { x: 80, y: 30, width: 120, height: 120 }],
    ["ne", { x: 220, y: 30 }, { x: 100, y: 30, width: 120, height: 120 }],
    ["sw", { x: 80, y: 170 }, { x: 80, y: 50, width: 120, height: 120 }],
    ["se", { x: 220, y: 170 }, { x: 100, y: 50, width: 120, height: 120 }],
  ]) assert.deepEqual(crop.resize(rect, handle, point, 400, 200, true), expected);
});
test("normalization preserves position on non-square sources", () => {
  const rect = { x: 100, y: 50, width: 100, height: 100 };
  const normalized = crop.normalized(rect, 400, 200);
  assert.deepEqual(normalized, [.25, .25, .5, .75]);
  assert.deepEqual(crop.fromNormalized(normalized, 400, 200), rect);
  assert.deepEqual(crop.square({ x: 0, y: 0, width: 200, height: 100 }), { x: 50, y: 0, width: 100, height: 100 });
});
test("zero-length drags always produce at least one pixel within the image", () => {
  assert.deepEqual(crop.draw({ x: 400, y: 200 }, { x: 400, y: 200 }, 400, 200, true), { x: 399, y: 199, width: 1, height: 1 });
});
