"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const R = require("../static/rasterizer.js"), { MosaicEditor } = require("../static/editor.js");

function pixels(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4);
  return data;
}

test("circle defaults match eight rings, 217 dots and a 7.5 cm print", () => {
  const result = R.rasterizePixels(pixels(90, 90, () => [255, 0, 0, 255]), 90, 90, { shape: "circle", palette: "image" });
  assert.deepEqual([result.grid_size, result.columns, result.rows, result.cells.length], [8, 17, 17, 217]);
  assert.equal(result.counts[0], 217);
  assert.deepEqual(R.linkedPrintDimensions(result, 7.5, 7.5), { width: 7.5, height: 7.5 });
  assert.match(R.exportSVG(result), /width="7.5cm" height="7.5cm"/);
  assert.deepEqual(R.pngDimensions(result), [886, 886]);
});

test("all ring sizes keep complete, touching dots with unpaintable curved spaces", () => {
  for (const rings of [1, 2, 8, 16]) {
    const grid = { ...R.gridLayout(rings, "circle"), grid_shape: "circle" };
    assert.equal(grid.cell_count, 1 + 3 * rings * (rings + 1));
    const dots = Array.from({ length: grid.cell_count }, (_, i) => R.cellCircle(grid, i));
    dots.forEach((dot, i) => {
      assert.equal(R.cellAtPoint(grid, dot.x, dot.y), i);
      assert.ok(dot.x - dot.rx >= -1e-12 && dot.x + dot.rx <= 1 + 1e-12 && dot.y - dot.ry >= -1e-12 && dot.y + dot.ry <= 1 + 1e-12);
      const reflected = R.cellCircle(grid, R.cellMirrorIndex(grid, i));
      assert.ok(Math.abs(reflected.x - (1 - dot.x)) < 1e-12 && Math.abs(reflected.y - dot.y) < 1e-12);
      for (const next of R.cellNeighbors(grid, i)) {
        assert.ok(R.cellNeighbors(grid, next).includes(i), `${rings}: ${i} ↔ ${next}`);
      }
      const next = dots[dot.ring ? 1 + 3 * (dot.ring - 1) * dot.ring + (dot.slot + 1) % (6 * dot.ring) : 1];
      assert.ok(Math.hypot(dot.x - next.x, dot.y - next.y) <= dot.rx + next.rx + 1e-12, "adjacent dots touch or overlap");
      assert.notEqual(R.cellAtPoint(grid, (dot.x + next.x) / 2, (dot.y + next.y) / 2), null, "no gap at the midpoint between adjacent dots");
    });
    assert.equal(R.cellAtPoint(grid, .001, .001), null);
    assert.notEqual(R.cellAtPoint(grid, .5, .5 - .5 / grid.rows), null);
  }
});

test("picking enlarged circle edges and overlaps agrees with the rendering order", () => {
  for (const rings of [1, 8, 16]) {
    const grid = { ...R.gridLayout(rings, "circle"), grid_shape: "circle" };
    const dots = Array.from({ length: grid.cell_count }, (_, i) => R.cellCircle(grid, i));
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const px = (x + .5) / 20, py = (y + .5) / 20;
      let expected = null;
      dots.forEach((dot, i) => {
        if (((px - dot.x) / dot.rx) ** 2 + ((py - dot.y) / dot.ry) ** 2 <= 1 + 1e-12) expected = i;
      });
      assert.equal(R.cellAtPoint(grid, px, py), expected);
    }
    assert.notEqual(R.cellAtPoint(grid, .5, .001), null, "outer dot edge remains paintable");
  }
});

test("circles sample their actual area and preserve solid-or-clear coverage", () => {
  const data = pixels(90, 90, (x, y) => x >= 33 && x < 35 && y >= 33 && y < 35 ? [0, 0, 0, 255] : [255, 0, 0, 255]);
  const result = R.rasterizePixels(data, 90, 90, { shape: "circle", grid: 1, palette: "image" });
  assert.equal(result.palette[result.cells[0]], "#FF0000", "bounding-box corners do not tint a circular dot");
  for (const alpha of [0, 127, 128, 255]) {
    const solid = R.rasterizePixels(pixels(90, 90, () => [255, 0, 0, alpha]), 90, 90, { shape: "circle" });
    assert.ok(solid.alphas.every(value => value === (alpha >= 128 ? 255 : 0)));
  }
});

test("ring painting, fill, mirroring and history preserve the same dots", () => {
  const grid = { ...R.gridLayout(8, "circle"), grid_shape: "circle" };
  const cells = new Array(grid.cell_count).fill(0), alphas = new Array(cells.length).fill(255);
  const editor = new MosaicEditor(cells, 3, 200, alphas);
  editor.fill(0, 1, grid, R.cellNeighbors);
  assert.ok(cells.every(color => color === 1)); assert.equal(editor.undoStack.length, 1);
  editor.undo(); assert.ok(cells.every(color => color === 0));
  editor.beginStroke(2); editor.paint(2); editor.endStroke();
  editor.beginStroke(-1); editor.paint(11); editor.endStroke(); editor.undo();
  editor.mirrorHorizontal(grid.columns, i => R.cellMirrorIndex(grid, i));
  assert.equal(cells[R.cellMirrorIndex(grid, 2)], 2);
  editor.redo(); assert.equal(alphas[R.cellMirrorIndex(grid, 11)], 0);
  editor.undo(); editor.undo(); assert.ok(cells.every(color => color === 0));
  const data = pixels(90, 90, x => x < 45 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  const original = R.rasterizePixels(data, 90, 90, { shape: "circle", palette: "image" });
  const mirrored = R.rasterizePixels(data, 90, 90, { shape: "circle", palette: "image", mirror: true });
  original.cells.forEach((_, i) => assert.equal(mirrored.cells[i], original.cells[R.cellMirrorIndex(original, i)]));
});

test("circle exports leave gaps clear or white according to the transparency setting", () => {
  const grid = R.gridLayout(8, "circle"), alphas = new Array(grid.cell_count).fill(255);
  alphas[2] = 0;
  const base = { ...grid, grid_shape: "circle", cells: new Array(grid.cell_count).fill(0), alphas, palette: ["#FF0000"] };
  for (const transparency of [true, false]) {
    const svg = R.exportSVG({ ...base, transparency, show_grid: true });
    assert.equal((svg.match(/<circle /g) || []).length, 216);
    assert.equal(svg.includes('<rect width="1" height="1" fill="#FFFFFF"/>'), !transparency);
    const dots = [], fills = [], ctx = { globalAlpha: 1, clearRect() {}, beginPath() {}, ellipse(...args) { dots.push(args); },
      fillRect() { fills.push(this.fillStyle); }, fill() {}, stroke() {} };
    R.paintExport({ getContext: () => ctx }, { ...base, transparency });
    assert.equal(dots.length, 216);
    assert.deepEqual(fills, transparency ? [] : ["#FFFFFF"]);
    assert.ok(dots.every(dot => Math.abs(dot[2] - dot[3]) < 1e-9));
  }
  for (const options of [{ grid: 0 }, { grid: 17 }, { grid: 1.5 }, { gridRows: 17 }])
    assert.throws(() => R.imageSettings(90, 90, { shape: "circle", ...options }));
  assert.throws(() => R.exportSVG({ ...base, rows: 15 }));
  assert.throws(() => R.exportSVG({ ...base, cells: new Array(289).fill(0) }));
});
