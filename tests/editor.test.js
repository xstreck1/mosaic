"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MosaicEditor } = require("../static/editor.js");

test("horizontal mirroring preserves shared cells, painted edits, and both history stacks", () => {
  const cells = [0, 1, 2, 3, 4, 5];
  const editor = new MosaicEditor(cells, 20);
  editor.beginStroke(18); editor.paint(0); editor.endStroke();
  editor.beginStroke(19); editor.paint(4); editor.endStroke();
  editor.undo();
  editor.mirrorHorizontal(3);
  assert.deepEqual(cells, [2, 1, 18, 5, 4, 3]);
  assert.equal(editor.canUndo, true);
  assert.equal(editor.canRedo, true);
  editor.redo();
  assert.deepEqual(cells, [2, 1, 18, 5, 19, 3]);
  editor.undo(); editor.undo();
  assert.deepEqual(cells, [2, 1, 0, 5, 4, 3]);
  editor.redo();
  editor.mirrorHorizontal(3);
  assert.deepEqual(cells, [18, 1, 2, 3, 4, 5]);
  editor.undo();
  assert.deepEqual(cells, [0, 1, 2, 3, 4, 5]);
});

test("mirroring finishes an active stroke and reverses even-width rows independently", () => {
  const cells = [0, 1, 2, 3];
  const editor = new MosaicEditor(cells, 20);
  editor.beginStroke(18); editor.paint(0);
  editor.mirrorHorizontal(2);
  assert.deepEqual(cells, [1, 18, 3, 2]);
  assert.equal(editor.stroke, null);
  editor.undo();
  assert.deepEqual(cells, [1, 0, 3, 2]);
  for (const columns of [0, 3, 1.5]) assert.throws(() => editor.mirrorHorizontal(columns), RangeError);
});

test("painting updates the shared mosaic data, and undo/redo restore it", () => {
  const cells = [2, 3, 4];
  const editor = new MosaicEditor(cells, 20);
  editor.beginStroke(19);
  editor.paint(1);
  editor.endStroke();
  assert.deepEqual(cells, [2, 19, 4]);
  assert.equal(editor.canUndo, true);
  editor.undo();
  assert.deepEqual(cells, [2, 3, 4]);
  assert.equal(editor.canRedo, true);
  editor.redo();
  assert.deepEqual(cells, [2, 19, 4]);
});

test("one drag is one undo step even when it revisits a square", () => {
  const cells = [1, 2, 3, 4];
  const editor = new MosaicEditor(cells, 20);
  editor.beginStroke(5);
  [0, 1, 2, 1, 3, 0].forEach((index) => editor.paint(index));
  editor.endStroke();
  assert.equal(editor.undoStack.length, 1);
  assert.deepEqual(cells, [5, 5, 5, 5]);
  editor.undo();
  assert.deepEqual(cells, [1, 2, 3, 4]);
  editor.redo();
  assert.deepEqual(cells, [5, 5, 5, 5]);
});

test("no-op strokes preserve redo and don't create history", () => {
  const editor = new MosaicEditor([1], 20);
  editor.beginStroke(2);
  editor.paint(0);
  editor.endStroke();
  editor.undo();
  editor.beginStroke(1);
  assert.equal(editor.paint(0), false);
  assert.equal(editor.endStroke(), false);
  assert.equal(editor.undoStack.length, 0);
  assert.equal(editor.canRedo, true);
  editor.redo();
  assert.deepEqual(editor.cells, [2]);
});

test("a new edit after undo clears only the redo branch", () => {
  const editor = new MosaicEditor([0, 0], 20);
  for (const color of [1, 2]) {
    editor.beginStroke(color);
    editor.paint(0);
    editor.endStroke();
  }
  editor.undo();
  editor.beginStroke(3);
  editor.paint(1);
  editor.endStroke();
  assert.equal(editor.canRedo, false);
  assert.deepEqual(editor.cells, [1, 3]);
  editor.undo();
  editor.undo();
  assert.deepEqual(editor.cells, [0, 0]);
});

test("undo can finish and reverse an active stroke", () => {
  const editor = new MosaicEditor([0, 1], 20);
  editor.beginStroke(19);
  editor.paint(0);
  editor.paint(1);
  assert.equal(editor.canUndo, true);
  editor.undo();
  assert.equal(editor.stroke, null);
  assert.deepEqual(editor.cells, [0, 1]);
  editor.redo();
  assert.deepEqual(editor.cells, [19, 19]);
});

test("history limit drops oldest steps without corrupting the current state", () => {
  const editor = new MosaicEditor([0], 20, 2);
  for (const color of [1, 2, 3]) {
    editor.beginStroke(color);
    editor.paint(0);
    editor.endStroke();
  }
  assert.equal(editor.undoStack.length, 2);
  editor.undo();
  editor.undo();
  assert.equal(editor.undo(), false);
  assert.deepEqual(editor.cells, [1]);
  editor.redo();
  editor.redo();
  assert.deepEqual(editor.cells, [3]);
});

test("out-of-bounds cells and palette indices cannot corrupt a mosaic", () => {
  const editor = new MosaicEditor([0], 20);
  for (const color of [-1, 20, 1.5]) assert.throws(() => editor.beginStroke(color), RangeError);
  editor.beginStroke(19);
  for (const index of [-1, 1, 0.5]) assert.equal(editor.paint(index), false);
  assert.equal(editor.endStroke(), false);
  assert.deepEqual(editor.cells, [0]);
});

test("custom paint colors preserve previous colors and both history branches", () => {
  const palette = ["#FFFFFF", "#000000"], cells = [0, 0];
  const editor = new MosaicEditor(cells, palette.length);
  editor.beginStroke(1); editor.paint(0); editor.endStroke(); editor.undo();
  const custom = editor.addColor("#ab12ef", palette);
  assert.equal(custom, 2);
  assert.deepEqual(palette, ["#FFFFFF", "#000000", "#AB12EF"]);
  assert.equal(editor.canRedo, true);
  editor.redo();
  editor.beginStroke(custom); editor.paint(1); editor.endStroke();
  assert.deepEqual(cells.map(index => palette[index]), ["#000000", "#AB12EF"]);
  editor.undo(); editor.undo();
  assert.deepEqual(cells, [0, 0]);
  editor.redo(); editor.redo();
  assert.deepEqual(cells, [1, 2]);
  assert.equal(editor.addColor("#AB12EF", palette), custom);
  assert.equal(palette.length, 3);
});

test("custom colors respect the export palette limit without blocking existing colors", () => {
  const palette = Array.from({ length: 64 }, (_, index) => `#${index.toString(16).padStart(6, "0")}`);
  const editor = new MosaicEditor([0], palette.length);
  assert.equal(editor.addColor("#00003f", palette), 63);
  assert.throws(() => editor.addColor("#FF00AA", palette), /64 colors/);
  for (const value of ["#123", "blue", "#FFFFFF<script>", null]) assert.throws(() => editor.addColor(value, palette), /six-digit/);
  assert.equal(palette.length, 64);
  assert.deepEqual(editor.cells, [0]);
});

test("square and hexagon exports include custom painted colors", () => {
  const rasterizer = require("../static/rasterizer.js");
  for (const grid_shape of ["square", "hexagon"]) {
    const layout = rasterizer.gridLayout(5, grid_shape), palette = ["#FFFFFF"];
    const cells = new Array(layout.columns * layout.rows).fill(0);
    const editor = new MosaicEditor(cells, palette.length);
    const custom = editor.addColor("#14CC88", palette);
    editor.beginStroke(custom); editor.paint(0); editor.endStroke();
    const svg = rasterizer.exportSVG({ ...layout, grid_shape, palette, cells, width_cm: 11, height_cm: 11 });
    assert.match(svg, /fill="#14CC88"/);
    assert.match(svg, /fill="#FFFFFF"/);
  }
});
