"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const R = require("../static/rasterizer.js");

function worker() {
  const messages = [], writes = [], calls = { rasterize: 0, decode: 0, flatten: 0 };
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
      return { fillRect() { calls.flatten++; }, drawImage() {},
        getImageData: (x, y, width, height) => {
          const data = new Uint8ClampedArray(width * height * 4);
          for (let i = 0; i < data.length; i += 4) data.set([100, 60, 80, 128], i);
          return { data, width, height };
        },
        putImageData: image => writes.push([...image.data.slice(0, 4)]) };
    }
    async convertToBlob() { return {}; }
  }
  const self = { postMessage: data => messages.push(data) };
  vm.runInNewContext(fs.readFileSync(require.resolve("../static/raster-worker.js"), "utf8"), {
    self, importScripts() {}, OffscreenCanvas: Canvas,
    FileReaderSync: class { readAsDataURL() { return "data:image/png;base64,preview"; } },
    createImageBitmap: async () => { calls.decode++; return { width: 10, height: 10, close() {} }; },
    MosaicRasterizer: { ...R, rasterizePixels(...args) { calls.rasterize++; return R.rasterizePixels(...args); } },
  });
  return { calls, messages, writes, send: options => self.onmessage({ data: { blob: { size: 100, type: "image/png" }, sourceId: 1, options } }) };
}

test("Original updates adjusted previews without ever calculating mosaic squares", async () => {
  const w = worker();
  await w.send({ grid: 5, previewOnly: true, brightness: 50 });
  assert.equal(w.calls.rasterize, 0);
  assert.equal(w.messages[0].result.preview_only, true);
  assert.equal(w.messages[0].result.cells, undefined);
  assert.deepEqual(w.writes[0], [150, 90, 120, 128]);
  await w.send({ grid: 33, palette: "image", colors: 64, previewOnly: true, brightness: 50 });
  assert.equal(w.calls.rasterize, 0);
  assert.equal(w.calls.decode, 1);
  assert.equal(w.writes.length, 1, "grid, palette and color-limit changes reuse the adjusted image preview");
  assert.equal(w.messages[1].result.color_count, 64);
  await w.send({ grid: 5, previewOnly: true, brightness: -50 });
  assert.equal(w.calls.rasterize, 0);
  assert.deepEqual(w.writes[1], [50, 30, 40, 128]);
});

test("Original and Mosaic preserve source alpha and refresh when white flattening is toggled", async () => {
  const w = worker();
  await w.send({ grid: 5, previewOnly: true });
  assert.equal(w.calls.flatten, 0);
  await w.send({ grid: 5 });
  assert.ok(w.messages[1].result.alphas.every(alpha => alpha === 255));
  await w.send({ grid: 5, previewOnly: true, transparency: false });
  assert.equal(w.calls.flatten, 1);
  await w.send({ grid: 5, transparency: false });
  assert.ok(w.messages[3].result.alphas.every(alpha => alpha === 255));
  assert.equal(w.calls.flatten, 1, "same flattened preview is cached");
  await w.send({ grid: 5, previewOnly: true, transparency: true });
  assert.equal(w.calls.flatten, 1);
  assert.equal(w.calls.decode, 1);
});

test("selecting Mosaic calculates squares once using the latest adjustment values", async () => {
  const w = worker();
  await w.send({ grid: 5, previewOnly: true, brightness: 50 });
  await w.send({ grid: 5, previewOnly: true, brightness: -50 });
  await w.send({ grid: 5, brightness: -50 });
  assert.equal(w.calls.rasterize, 1);
  assert.equal(w.calls.decode, 1);
  assert.equal(w.messages[2].result.cells.length, 25);
  assert.equal(w.messages[2].result.adjustments.brightness, -50);
  assert.equal(w.messages[2].result.preview_only, false);
  assert.equal(w.writes.length, 2, "mosaic and Original share the cached adjusted preview");
});

test("hexagon selection in Original defers tile calculation until Mosaic and preserves the shape", async () => {
  const w = worker();
  await w.send({ grid: 5, shape: "hexagon", previewOnly: true, brightness: 30 });
  assert.equal(w.calls.rasterize, 0);
  assert.equal(w.messages[0].result.grid_shape, "hexagon");
  assert.equal(w.messages[0].result.grid_size, 5);
  assert.equal(w.messages[0].result.cells, undefined);
  await w.send({ grid: 5, shape: "hexagon", brightness: 30 });
  assert.equal(w.calls.rasterize, 1);
  assert.equal(w.messages[1].result.cells.length, 30);
  assert.equal(w.writes.length, 1);
});

test("Original preserves independent grid axes without calculating tiles", async () => {
  for (const shape of ["square", "hexagon"]) {
    const w = worker();
    await w.send({ grid: 7, gridRows: 17, shape, previewOnly: true, brightness: 30 });
    assert.equal(w.calls.rasterize, 0);
    assert.deepEqual([w.messages[0].result.columns, w.messages[0].result.rows], [7, 17]);
    await w.send({ grid: 7, gridRows: 17, shape, brightness: 30 });
    assert.equal(w.calls.rasterize, 1);
    assert.equal(w.messages[1].result.cells.length, 119);
    assert.equal(w.calls.decode, 1);
    assert.equal(w.writes.length, 1);
  }
});

test("circle selection defers sampling in Original and calculates 217 dots in Mosaic", async () => {
  const w = worker();
  await w.send({ shape: "circle", previewOnly: true });
  assert.equal(w.calls.rasterize, 0);
  assert.equal(w.messages[0].result.cell_count, 217);
  assert.equal(w.messages[0].result.cells, undefined);
  await w.send({ shape: "circle" });
  assert.equal(w.calls.rasterize, 1);
  assert.equal(w.messages[1].result.cells.length, 217);
  assert.ok(w.messages[1].result.alphas.every(alpha => alpha === 255));
});
