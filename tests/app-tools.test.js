"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const R = require("../static/rasterizer.js");
const { MosaicEditor } = require("../static/editor.js");

// Exercise the app's registered tool and pointer handlers without starting the
// sample gallery or a browser worker. Canvas drawing is irrelevant to these clicks.
function setup(cells, shape = "square") {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const handlers = new Map(), attributes = new Map(), classes = new Set();
    const node = {
      value: "11", checked: false, children: [], clientWidth: 400, clientHeight: 400,
      style: { setProperty() {} },
      classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
      addEventListener(name, handler) {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(handler);
      },
      emit(name, event = {}) {
        for (const handler of handlers.get(name) || []) handler({ preventDefault() {}, ...event });
      },
      checkValidity: () => true, focus() {}, hasPointerCapture: () => false,
      setPointerCapture() { throw new Error("Picker and fill must not start a drag stroke."); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      getContext: () => ({ fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, strokeRect() {} })
    };
    elements.set(id, node);
    return node;
  }
  const context = vm.createContext({
    document: { getElementById: element },
    window: { innerWidth: 1000, addEventListener() {} },
    BrowserRasterizer: class {}, MosaicRasterizer: R, MosaicEditor,
    ResizeObserver: class { observe() {} }
  });
  const source = fs.readFileSync(require.resolve("../static/app.js"), "utf8");
  vm.runInContext(source.replace(/initializeGallery\(\);\s*$/, "") + "\nglobalThis.appState = state;", context);
  const state = context.appState;
  state.result = { columns: 3, rows: 3, cells, grid_shape: shape, mirror: false,
    palette: ["#FFFFFF", "#000000", "#FF0000"], palette_names: ["White", "Black", "Red"] };
  state.preview = state.result;
  state.result.alphas = new Array(cells.length).fill(255);
  state.editor = new MosaicEditor(cells, 3, 200, state.result.alphas);
  state.mosaicDirty = false;
  state.shape = shape;
  vm.runInContext("refreshEdits()", context);
  const clickTile = (x, y, name = "pointerdown") => element("previewCanvas").emit(name,
    { button: 0, pointerId: 1, clientX: x, clientY: y });
  return { state, element, clickTile, context };
}

test("eyedropper selects the tile color, returns to Brush, and preserves redo", () => {
  const cells = [0, 0, 0, 0, 2, 0, 0, 0, 0], app = setup(cells);
  app.state.editor.beginStroke(1); app.state.editor.paint(0); app.state.editor.endStroke(); app.state.editor.undo();
  app.element("pickerTool").emit("click");
  assert.equal(app.element("pickerTool").getAttribute("aria-pressed"), "true");
  app.clickTile(50, 50);
  assert.equal(app.state.selectedColor, 2);
  assert.equal(app.state.tool, "brush");
  assert.equal(app.element("brushTool").getAttribute("aria-pressed"), "true");
  assert.equal(app.element("customColorHex").value, "#FF0000");
  assert.equal(app.state.editor.canRedo, true);
  assert.deepEqual(cells, [0, 0, 0, 0, 2, 0, 0, 0, 0]);
});

test("bucket clicks update colors and usage once, preserve the tool, and undo together", () => {
  const cells = [0, 0, 1, 1, 0, 1, 0, 1, 0], app = setup(cells);
  app.element("fillTool").emit("click");
  vm.runInContext("selectColor(2)", app.context);
  assert.equal(app.state.tool, "fill");
  app.clickTile(10, 10);
  assert.deepEqual(cells, [2, 2, 1, 1, 2, 1, 0, 1, 0]);
  assert.deepEqual(Array.from(app.state.result.counts), [2, 4, 3]);
  app.clickTile(90, 90, "pointermove");
  assert.equal(cells[8], 0);
  assert.equal(app.state.editor.undoStack.length, 1);
  app.element("undoButton").emit("click");
  assert.deepEqual(cells, [0, 0, 1, 1, 0, 1, 0, 1, 0]);
  app.element("redoButton").emit("click");
  assert.equal(cells[0], 2);
});

test("tools ignore hexagon margins and unavailable mosaics", () => {
  const cells = new Array(9).fill(0), app = setup(cells, "hexagon");
  for (const id of ["pickerTool", "fillTool"]) {
    app.element(id).emit("click"); app.clickTile(.1, .1);
    assert.equal(app.state.editor.canUndo, false);
    assert.equal(app.state.selectedColor, 0);
  }
  app.state.mosaicDirty = true;
  vm.runInContext("updateEditingControls()", app.context);
  assert.equal(app.element("fillTool").disabled, true);
  app.state.selectedColor = 2;
  app.clickTile(50, 50);
  assert.ok(cells.every(color => color === 0));
});

test("transparent swatch erases with bucket fill and eyedropper can pick the erased region", () => {
  const app = setup(new Array(9).fill(0));
  app.element("fillTool").emit("click");
  app.element("transparentColor").emit("click");
  app.clickTile(50, 50);
  assert.ok(app.state.result.alphas.every(alpha => alpha === 0));
  assert.equal(app.state.result.used_colors, 0);
  app.element("pickerTool").emit("click"); app.clickTile(50, 50);
  assert.equal(app.state.selectedColor, -1);
  assert.equal(app.element("brushName").textContent, "Clear");
  app.element("undoButton").emit("click");
  assert.ok(app.state.result.alphas.every(alpha => alpha === 255));
  assert.equal(app.state.result.used_colors, 1);
});
