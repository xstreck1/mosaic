"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const R = require("../static/rasterizer.js");

function worker() {
  const messages = [], writes = [], calls = { rasterize: 0, decode: 0 };
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
      return { fillRect() {}, drawImage() {},
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
  assert.equal(w.messages[1].result.cells.length, 42);
  assert.equal(w.writes.length, 1);
});
