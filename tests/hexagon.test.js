"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const R = require("../static/rasterizer.js");
const { MosaicEditor } = require("../static/editor.js");
const area = points => Math.abs(points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
function pixels(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 4);
  return data;
}

test("every hexagon has six complete vertices inside the board, with unpaintable outer margins", () => {
  for (const size of [5, 21, 64]) for (const mirror of [false, true]) {
    const grid = { ...R.gridLayout(size, "hexagon"), grid_shape: "hexagon", mirror };
    const cells = grid.columns * grid.rows;
    const expectedArea = .75 / ((grid.columns + .5) * ((grid.rows - 1) * .75 + 1));
    for (let index = 0; index < cells; index++) {
      const polygon = R.cellPolygon(grid, index);
      assert.equal(polygon.length, 6);
      assert.ok(polygon.every(point => point.every(value => value >= 0 && value <= 1)));
      assert.ok(Math.abs(area(polygon) - expectedArea) < 1e-12);
      assert.ok(Math.abs(area(R.clippedCell(grid, index)) - expectedArea) < 1e-12);
      const center = polygon.reduce((sum, point) => sum.map((value, axis) => value + point[axis] / 6), [0, 0]);
      assert.equal(R.cellAtPoint(grid, ...center), index);
    }
    for (let y = 0; y < 97; y++) for (let x = 0; x < 99; x++) {
      const index = R.cellAtPoint(grid, (x + .37) / 99, (y + .41) / 97);
      if (index !== null) assert.ok(index >= 0 && index < cells);
    }
    assert.equal(R.cellAtPoint(grid, -0.1, .5), null);
    assert.equal(R.cellAtPoint(grid, .5, 1), null);
    for (const point of [[.001, .001], [.999, .001], [.001, .999], [.999, .999]]) assert.equal(R.cellAtPoint(grid, ...point), null);
  }
});

test("complete hexagonal sampling preserves solid colors and transparent backgrounds", () => {
  for (const [width, height, color] of [[19, 19, [17, 110, 224, 255]], [1, 1, [255, 0, 0, 255]], [19, 19, [0, 0, 0, 0]]]) {
    const result = R.rasterizePixels(pixels(width, height, () => color), width, height, { grid: 5, shape: "hexagon", palette: "image", colors: 64 });
    assert.equal(result.cells.length, 30);
    assert.deepEqual(result.palette, [color[3] ? "#" + color.slice(0, 3).map(c => c.toString(16).padStart(2, "0")).join("").toUpperCase() : "#FFFFFF"]);
    assert.equal(result.counts[0], 30);
  }
});

test("hexagon colors average actual polygon coverage rather than bounding rectangles", () => {
  const width = 17, height = 13;
  const data = pixels(width, height, (x, y) => [x * 13, y * 18, (x * 31 + y * 7) % 256, 255]);
  const result = R.rasterizePixels(data, width, height, { grid: 5, shape: "hexagon", palette: "image", colors: 64 });
  // Independently intersect each image pixel with each hexagon using polygon clipping.
  function clip(points, axis, edge, sign) {
    const output = [];
    let a = points.at(-1);
    for (const b of points) {
      const da = sign * (a[axis] - edge), db = sign * (b[axis] - edge);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        output.push(a.map((v, c) => v + t * (b[c] - v)));
      }
      if (db >= 0) output.push(b);
      a = b;
    }
    return output;
  }
  for (let index = 0; index < result.cells.length; index++) {
    const polygon = R.clippedCell(result, index).map(([x, y]) => [2 + x * 13, y * 13]);
    const total = area(polygon), sum = [0, 0, 0];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let intersection = polygon;
      for (const [axis, edge, sign] of [[0, x, 1], [0, x + 1, -1], [1, y, 1], [1, y + 1, -1]]) {
        if (!intersection.length) break;
        intersection = clip(intersection, axis, edge, sign);
      }
      const weight = area(intersection);
      sum.forEach((_, c) => { sum[c] += data[(y * width + x) * 4 + c] * weight; });
    }
    const actual = [1, 3, 5].map(i => parseInt(result.palette[result.cells[index]].slice(i, i + 2), 16));
    actual.forEach((value, c) => assert.ok(Math.abs(value - sum[c] / total) <= .501, `tile ${index}, channel ${c}`));
  }
});

test("hexagon crops, contained white margins and color adjustments use the selected source pixels", () => {
  const data = pixels(40, 20, (x, y) => x < 20 ? [255, 0, 0, 255] : [30, y * 8, 220, x % 3 ? 255 : 128]);
  const options = { grid: 5, shape: "hexagon", palette: "image", colors: 64, fit: "contain", crop: [.5, 0, 1, .5], vibrance: 50, contrast: -20 };
  const direct = R.rasterizePixels(data, 40, 20, options);
  const adjusted = R.rasterizePixels(R.adjustPixels(data, options), 40, 20, { ...options, vibrance: 0, contrast: 0 });
  assert.deepEqual(direct.cells, adjusted.cells);
  assert.deepEqual(direct.palette, adjusted.palette);
  assert.deepEqual(direct.crop_size, [20, 10]);
  assert.equal(direct.palette[direct.cells[2]], "#FFFFFF");
  assert.notEqual(direct.palette[direct.cells[R.cellAtPoint(direct, .5, .5)]], "#FFFFFF");
  assert.ok(!direct.palette.includes("#FF0000"), "the excluded red half cannot affect the crop");
});

test("mirroring reflects staggered geometry, colors, painted edits and history together", () => {
  const data = pixels(30, 30, (x, y) => [x * 8, y * 8, 150, 255]);
  const original = R.rasterizePixels(data, 30, 30, { grid: 5, shape: "hexagon", palette: "image" });
  const mirrored = R.rasterizePixels(data, 30, 30, { grid: 5, shape: "hexagon", palette: "image", mirror: true });
  for (let y = 0; y < 51; y++) for (let x = 0; x < 53; x++) {
    const px = (x + .37) / 53, py = (y + .41) / 51;
    const a = R.cellAtPoint(original, 1 - px, py), b = R.cellAtPoint(mirrored, px, py);
    assert.equal(original.cells[a], mirrored.cells[b]);
  }
  const editor = new MosaicEditor(original.cells, original.palette.length), painted = R.cellAtPoint(original, .2, .3), before = original.cells[painted];
  const color = (before + 1) % original.palette.length;
  editor.beginStroke(color); editor.paint(painted); editor.endStroke(); editor.mirrorHorizontal(original.columns);
  original.mirror = true;
  const reflected = R.cellAtPoint(original, .8, .3);
  assert.equal(original.cells[reflected], color);
  editor.undo(); assert.equal(original.cells[reflected], before);
  editor.redo(); assert.equal(original.cells[reflected], color);
});

test("hexagonal SVG and PNG use polygons, physical dimensions and current painted colors", () => {
  const result = R.rasterizePixels(pixels(10, 10, () => [255, 255, 255, 255]), 10, 10, { grid: 64, shape: "hexagon", palette: "vibrant" });
  result.cells[0] = 0;
  const payload = { ...result, width_cm: 5, height_cm: 10, show_grid: true };
  const svg = R.exportSVG(payload);
  assert.match(svg, /width="5cm" height="10cm" viewBox="0 0 1 1"/);
  assert.match(svg, /<polygon points="[^"]+" fill="#DA0D0B"/);
  assert.equal((svg.match(/<polygon /g) || []).length, result.cells.length * 2);
  for (const match of svg.matchAll(/<polygon points="([^"]+)"/g)) {
    const points = match[1].split(" ").map(point => point.split(",").map(Number));
    assert.equal(points.length, 6, "exported edge tiles must remain complete hexagons");
    assert.ok(points.every(point => point.every(value => value >= 0 && value <= 1)));
  }
  assert.ok(!svg.includes("<rect"));
  const calls = { fill: 0, stroke: 0, points: 0 }, ctx = { clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() { calls.points++; }, closePath() {}, fill() { calls.fill++; }, stroke() { calls.stroke++; } };
  const canvas = { getContext: () => ctx };
  R.paintExport(canvas, payload);
  assert.deepEqual([canvas.width, canvas.height], [591, 1181]);
  assert.equal(calls.fill, result.cells.length);
  assert.equal(calls.stroke, result.cells.length * 2);
  assert.equal(calls.points, result.cells.length * 10);
  assert.throws(() => R.imageSettings(10, 10, { shape: "triangle" }));
  assert.throws(() => R.exportSVG({ ...payload, grid_shape: "triangle" }));
});
