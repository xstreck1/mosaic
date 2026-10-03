"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../static/browser-rasterizer.js"), "utf8");
function setup() {
  const workers = [];
  class Worker {
    constructor(url) { this.url = url; workers.push(this); }
    postMessage(data) { this.message = data; }
    terminate() { this.terminated = true; }
  }
  const Client = vm.runInNewContext(source + "\nBrowserRasterizer", { Worker, DOMException });
  return { client: new Client(), workers };
}
test("conversion posts pixels locally to a reusable worker and returns its result", async () => {
  const { client, workers } = setup(), controller = new AbortController(), blob = new Blob(["image"]);
  const first = client.convert(blob, 1, { grid: 21 }, controller.signal);
  assert.equal(workers[0].url, "./raster-worker.js");
  assert.equal(workers[0].message.blob, blob);
  assert.equal(workers[0].message.sourceId, 1);
  workers[0].onmessage({ data: { result: { cells: [18] } } });
  assert.deepEqual(await first, { cells: [18] });
  const second = client.convert(blob, 1, { grid: 22 }, controller.signal);
  assert.equal(workers.length, 1);
  workers[0].onmessage({ data: { result: { cells: [16] } } });
  assert.deepEqual(await second, { cells: [16] });
});
test("rapid changes terminate stale conversions and use a fresh worker", async () => {
  const { client, workers } = setup(), controller = new AbortController();
  const old = client.convert(new Blob(["old"]), 1, {}, controller.signal);
  controller.abort();
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(workers[0].terminated, true);
  const next = client.convert(new Blob(["new"]), 2, {}, new AbortController().signal);
  assert.equal(workers.length, 2);
  workers[1].onmessage({ data: { result: { cells: [2] } } });
  assert.deepEqual(await next, { cells: [2] });
});
test("decode errors are readable and worker failures allow retry", async () => {
  const { client, workers } = setup();
  const decode = client.convert(new Blob(["bad"]), 1, {}, new AbortController().signal);
  workers[0].onmessage({ data: { error: "This image could not be read." } });
  await assert.rejects(decode, /could not be read/);
  const failure = client.convert(new Blob(["bad"]), 2, {}, new AbortController().signal);
  workers[0].onerror();
  await assert.rejects(failure, /processing failed/);
  assert.equal(workers[0].terminated, true);
  const retry = client.convert(new Blob(["good"]), 3, {}, new AbortController().signal);
  workers[1].onmessage({ data: { result: { cells: [18] } } });
  assert.deepEqual(await retry, { cells: [18] });
});
