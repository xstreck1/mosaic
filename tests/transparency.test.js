"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const R = require("../static/rasterizer.js");
const { MosaicEditor } = require("../static/editor.js");

function pixels(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4);
  return data;
}

test("transparent tiles are solid or clear without consuming palette slots or using hidden RGB", () => {
  const source = pixels(10, 10, x => x < 2 ? [0, 255, 0, 0] : [255, 0, 0, 128]);
  for (const shape of ["square", "hexagon"]) for (const palette of ["image", "vibrant", "rainbow"]) {
    const result = R.rasterizePixels(source, 10, 10, { grid: 5, shape, palette, colors: 2 });
    const other = R.rasterizePixels(pixels(10, 10, x => x < 2 ? [0, 0, 255, 0] : [255, 0, 0, 128]), 10, 10,
      { grid: 5, shape, palette, colors: 2 });
    assert.deepEqual(result, other);
    assert.ok(result.palette.length <= 2);
    assert.ok(result.alphas.some(alpha => alpha === 0));
    assert.ok(result.alphas.some(alpha => alpha === 255));
    assert.ok(result.alphas.every(alpha => alpha === 0 || alpha === 255));
    assert.equal(result.counts.reduce((a, b) => a + b), result.alphas.filter(Boolean).length);
    if (palette === "image") assert.deepEqual(result.palette, ["#FF0000"]);
  }
});

test("fully transparent images produce empty exports and zero used colors", () => {
  for (const shape of ["square", "hexagon"]) {
    const result = R.rasterizePixels(pixels(10, 10, () => [99, 200, 40, 0]), 10, 10, { grid: 5, shape });
    assert.equal(result.used_colors, 0);
    assert.ok(result.alphas.every(alpha => alpha === 0));
    assert.doesNotMatch(R.exportSVG({ ...result, show_grid: true }), /<(rect|polygon|path) /);
  }
});

test("source alpha uses a half-coverage cutoff for solid or clear tiles in both shapes", () => {
  for (const shape of ["square", "hexagon"]) for (const alpha of [0, 1, 64, 127, 128, 254, 255]) {
    const result = R.rasterizePixels(pixels(17, 17, () => [255, 0, 0, alpha]), 17, 17,
      { grid: 5, shape, palette: "image" });
    assert.ok(result.alphas.every(value => value === (alpha >= 128 ? 255 : 0)), `${shape}: ${alpha}`);
    assert.equal(result.used_colors, alpha >= 128 ? 1 : 0);
    if (alpha >= 128) assert.deepEqual(result.palette, ["#FF0000"]);
    assert.throws(() => new MosaicEditor(result.cells, result.palette.length, 200,
      new Array(result.cells.length).fill(128)), /solid or clear/);
  }
});

test("alpha coverage includes fractional squares, contain padding, crop and mirroring", () => {
  const data = pixels(10, 10, x => x % 2 ? [255, 0, 0, 255] : [0, 0, 255, 0]);
  const result = R.rasterizePixels(data, 10, 10, { grid: 5, palette: "image" });
  assert.deepEqual(result.palette, ["#FF0000"]);
  assert.ok(result.alphas.every(alpha => alpha === 255));
  const padded = R.rasterizePixels(pixels(15, 5, () => [100, 200, 40, 255]), 15, 5,
    { grid: 5, fit: "contain", palette: "image" });
  assert.equal(padded.alphas[0], 0); assert.equal(padded.alphas[12], 255);
  const original = R.rasterizePixels(pixels(10, 10, x => [255, 0, 0, x * 25]), 10, 10,
    { grid: 5, crop: [0, 0, .8, 1], palette: "image" });
  const mirrored = R.rasterizePixels(pixels(10, 10, x => [255, 0, 0, x * 25]), 10, 10,
    { grid: 5, crop: [0, 0, .8, 1], palette: "image", mirror: true });
  for (let row = 0; row < 5; row++) assert.deepEqual(mirrored.alphas.slice(row * 5, row * 5 + 5), original.alphas.slice(row * 5, row * 5 + 5).reverse());
});

test("erasing, painting and filling restore solid and clear tiles through undo, redo and mirror", () => {
  const cells = [0, 1, 2, 0, 0, 0], alphas = [0, 0, 255, 255, 0, 255];
  const editor = new MosaicEditor(cells, 3, 200, alphas), grid = { columns: 3, rows: 2 };
  editor.fill(0, 2, grid);
  assert.deepEqual(alphas, [255, 255, 255, 255, 255, 255]);
  assert.deepEqual(cells, [2, 2, 2, 0, 2, 0]);
  editor.undo(); assert.deepEqual(alphas, [0, 0, 255, 255, 0, 255]);
  editor.beginStroke(-1); editor.paint(2); editor.endStroke();
  assert.equal(alphas[2], 0);
  editor.mirrorHorizontal(3);
  editor.undo(); assert.deepEqual(alphas, [255, 0, 0, 255, 0, 255]);
  editor.redo(); assert.equal(alphas[0], 0);
  editor.beginStroke(1); editor.paint(0); editor.endStroke();
  assert.equal(alphas[0], 255);
  editor.undo(); assert.equal(alphas[0], 0);
});

test("SVG and PNG skip transparent tiles, paint opaque colors and hide their grid lines", () => {
  for (const grid_shape of ["square", "hexagon"]) {
    const cells = new Array(25).fill(0), alphas = new Array(25).fill(0);
    alphas[6] = 255; alphas[7] = 255;
    const payload = { columns: 5, rows: 5, grid_shape, cells, alphas, palette: ["#FF0000"], show_grid: true };
    const svg = R.exportSVG(payload);
    assert.equal((svg.match(/<(rect|polygon) /g) || []).length, 4);
    assert.doesNotMatch(svg, /opacity=/);
    const fills = [], lines = [];
    let clears = 0;
    const ctx = { globalAlpha: 1, clearRect() { clears++; }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fillRect() { fills.push(this.globalAlpha); }, fill() { fills.push(this.globalAlpha); },
      stroke() { lines.push(this.globalAlpha); }, strokeRect() { lines.push(this.globalAlpha); } };
    R.paintExport({ getContext: () => ctx }, payload);
    assert.equal(clears, 1);
    assert.deepEqual(fills, [1, 1]);
    assert.ok(lines.every(alpha => alpha > 0));
    assert.equal(ctx.globalAlpha, 1);
    for (const invalid of [null, [0], new Array(25).fill(-1), new Array(25).fill(128), new Array(25).fill(256), new Array(25).fill(true)])
      assert.throws(() => R.exportSVG({ ...payload, alphas: invalid }), /opacity/);
  }
});
