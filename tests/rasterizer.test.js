"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const R = require("../static/rasterizer.js");
const { MosaicEditor } = require("../static/editor.js");

function pixels(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 4);
  return data;
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function solid(color, options = {}) { return R.rasterizePixels(pixels(25, 25, () => color), 25, 25, { grid: 5, ...options }); }
const used = result => new Set(result.cells.map(i => result.palette[i]));
const output = (color, options = {}) => [...used(solid([...color, 255], { palette: "image", ...options }))][0];

test("Original and Mosaic share identical foreground color adjustments and preserve alpha", () => {
  const data = pixels(10, 10, (x, y) => [x * 25, y * 25, 170, x % 3 === 0 ? 0 : x % 3 === 1 ? 128 : 255]);
  const options = { vibrance: 70, brightness: 15, contrast: -20 };
  const adjusted = R.adjustPixels(data, options);
  assert.notDeepEqual(adjusted, data);
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(adjusted[i + 3], data[i + 3]);
    if (!data[i + 3]) assert.deepEqual(adjusted.slice(i, i + 4), data.slice(i, i + 4));
  }
  const direct = R.rasterizePixels(data, 10, 10, { grid: 5, palette: "image", ...options });
  const fromPreview = R.rasterizePixels(adjusted, 10, 10, { grid: 5, palette: "image" });
  assert.deepEqual(direct.cells, fromPreview.cells);
  assert.deepEqual(direct.palette, fromPreview.palette);
  assert.deepEqual(R.adjustPixels(data), data);
});

test("preview settings normalize cropping without creating cells or palettes", () => {
  const settings = R.imageSettings(100, 50, { grid: 33, crop: [.5, 0, 1, 1], vibrance: 30 });
  assert.deepEqual(settings.crop_size, [50, 50]);
  assert.equal(settings.adjustments.vibrance, 30);
  assert.equal(settings.columns, 33);
  assert.equal(settings.cells, undefined);
  assert.equal(settings.palette, undefined);
});

test("reference palette contains 20 distinct colors and matches every swatch exactly", () => {
  assert.equal(R.PALETTE.length, 20); assert.equal(new Set(R.PALETTE).size, 20);
  assert.equal(R.PALETTE[16], "#000000"); assert.equal(R.PALETTE[18], "#FFFFFF");
  R.PALETTE.forEach((color, i) => assert.deepEqual(solid([...rgb(color), 255]).cells, Array(25).fill(i)));
});
test("defaults retain the 21 by 21 grid and reference palette", () => {
  const result = R.rasterizePixels(pixels(25, 25, () => [...rgb(R.PALETTE[10]), 255]), 25, 25);
  assert.equal(result.cells.length, 441); assert.equal(result.columns, 21);
  assert.equal(result.counts[10], 441); assert.equal(result.used_colors, 1); assert.equal(result.mirror, false);
});
test("muted pink retains its hue with neutral or increased vibrance", () => {
  assert.deepEqual(solid([194, 151, 170, 255]).cells, Array(25).fill(2));
  assert.deepEqual(solid([194, 151, 170, 255], { vibrance: 100 }).cells, Array(25).fill(2));
});

test("sunset blue and teal layers retain their hue instead of becoming neutral", () => {
  for (const [color, expected] of [["#8EB0AD", 10], ["#557B8E", 12], ["#334C6B", 11], ["#17253B", 11]]) {
    assert.deepEqual(solid([...rgb(color), 255]).cells, Array(25).fill(expected), color);
  }
  assert.deepEqual(solid([...rgb("#F1E9CE"), 255]).cells, Array(25).fill(5), "sun stays yellow");
});

test("neutral samples remain neutral and hue wraps across red at zero degrees", () => {
  for (const color of [[0, 0, 0], [255, 255, 255], [130, 130, 130], [130, 132, 135], [250, 249, 248], [3, 6, 9]]) {
    const result = solid([...color, 255]);
    assert.ok(result.cells.every(index => index >= 16), color.join(","));
  }
  assert.deepEqual(solid([200, 10, 20, 255]).cells, Array(25).fill(0));
  assert.deepEqual(solid([200, 20, 10, 255]).cells, Array(25).fill(0));
});
test("averaging includes all source pixels and handles fractional cell boundaries", () => {
  const data = pixels(10, 10, x => x % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  assert.deepEqual(used(R.rasterizePixels(data, 10, 10, { grid: 5, palette: "image" })), new Set(["#808080"]));
  const odd = R.rasterizePixels(pixels(7, 7, () => [100, 120, 140, 255]), 7, 7, { grid: 5, palette: "image" });
  assert.deepEqual(used(odd), new Set(["#64788C"]));
});
test("hidden transparent colors and semi-transparent edges blend onto white", () => {
  for (const palette of ["image", "studio"]) {
    assert.deepEqual(used(solid([210, 3, 55, 0], { palette })), new Set(["#FFFFFF"]));
    assert.deepEqual(used(solid([210, 3, 55, 0], { palette, vibrance: 100, brightness: -100, contrast: -100 })), new Set(["#FFFFFF"]));
  }
  assert.deepEqual(used(solid([255, 0, 0, 128], { palette: "image" })), new Set(["#FF7F7F"]));
  assert.deepEqual(used(solid([100, 20, 30, 128], { palette: "image", brightness: -100 })), new Set(["#7F7F7F"]));
});
test("foreground alpha is flattened before cell averaging", () => {
  const data = pixels(10, 10, x => x % 2 ? [255, 0, 0, 255] : [0, 0, 255, 0]);
  assert.deepEqual(used(R.rasterizePixels(data, 10, 10, { grid: 5, palette: "image" })), new Set(["#FF8080"]));
});
test("brightness, contrast and adaptive vibrance affect colors predictably", () => {
  assert.equal(output([100, 100, 100], { brightness: 50 }), "#969696");
  assert.equal(output([100, 100, 100], { brightness: -50 }), "#323232");
  assert.equal(output([64, 128, 192], { contrast: 100 }), "#0080FF");
  assert.equal(output([64, 128, 192], { contrast: -100 }), "#808080");
  assert.equal(output([128, 128, 128], { vibrance: 100 }), "#808080");
  assert.equal(output([255, 0, 0], { vibrance: 100 }), "#FF0000");
  const muted = [194, 151, 170], vivid = rgb(output(muted, { vibrance: 100 })), soft = rgb(output(muted, { vibrance: -100 }));
  assert.ok(Math.max(...vivid) - Math.min(...vivid) > 43);
  assert.ok(Math.max(...soft) - Math.min(...soft) < 43);
});
test("crop selects original pixels, normalizes edges, and remains stable on regeneration", () => {
  const data = pixels(10, 5, x => [...rgb(R.PALETTE[x < 5 ? 10 : 0]), 255]);
  const result = R.rasterizePixels(data, 10, 5, { grid: 5, crop: [.5, 0, 1, 1] });
  assert.deepEqual(result.cells, Array(25).fill(0)); assert.deepEqual(result.crop_size, [5, 5]);
  assert.deepEqual(result.source_size, [10, 5]);
  assert.deepEqual(R.rasterizePixels(data, 10, 5, { grid: 5, crop: result.crop }), result);
  assert.deepEqual(R.cropBounds(800, 800, [.2173913, .10869565, .8597826, .7510869]), [174, 87, 688, 601]);
});
test("contain adds white padding while cover crops the centered square", () => {
  const data = pixels(15, 5, x => [...rgb(R.PALETTE[x >= 5 && x < 10 ? 10 : 0]), 255]);
  const cover = R.rasterizePixels(data, 15, 5, { grid: 5 });
  const fit = R.rasterizePixels(data, 15, 5, { grid: 5, fit: "contain", brightness: -100 });
  assert.deepEqual(cover.cells, Array(25).fill(10)); assert.equal(fit.cells[0], 18); assert.equal(fit.cells[12], 16);
});
test("adaptive palettes keep exact colors for simple images and quantize complex images to 20", () => {
  const image = pixels(64, 64, (x, y) => [x * 4, y * 4, ((x + y) % 64) * 4, 255]);
  const result = R.rasterizePixels(image, 64, 64, { grid: 64, palette: "image" });
  assert.equal(result.palette.length, 20); assert.ok(result.used_colors <= 20); assert.equal(result.cells.length, 4096);
  const simple = solid([77, 99, 123, 255], { palette: "image" });
  assert.equal(simple.palette.length, 1); assert.equal(simple.used_colors, 1); assert.deepEqual(used(simple), new Set(["#4D637B"]));
  assert.equal(result.counts.reduce((a, b) => a + b), 4096);
});

test("every fixed palette has a distinct finite catalog and reproduces its own colors", () => {
  for (const [mode, preset] of Object.entries(R.PRESETS)) {
    if (mode === "image") continue;
    assert.equal(preset.colors.length, preset.max, mode);
    assert.equal(new Set(preset.colors).size, preset.max, mode);
    preset.colors.forEach((color, i) => {
      const result = solid([...rgb(color), 255], { palette: mode, colors: preset.max });
      assert.deepEqual(result.cells, Array(25).fill(i), `${mode}: ${color}`);
    });
  }
  assert.equal(R.PRESETS.commodore64.max, 16);
});

test("color limits bound all palette sizes and exports while preserving white transparency", () => {
  const data = pixels(32, 32, (x, y) => [x * 8, y * 8, (x + y) % 32 * 8, x < 5 ? 0 : 255]);
  for (const [mode, preset] of Object.entries(R.PRESETS)) {
    for (const colors of [2, 5, preset.max]) {
      const result = R.rasterizePixels(data, 32, 32, { grid: 32, palette: mode, colors });
      assert.ok(result.palette.length <= colors, mode);
      assert.equal(new Set(result.palette).size, result.palette.length, mode);
      assert.equal(result.counts.reduce((a, b) => a + b), 1024);
      assert.ok(result.cells.every(i => i < result.palette.length));
      if (mode !== "image") {
        assert.equal(result.palette[result.cells[0]], "#FFFFFF", `${mode}: white background`);
        assert.ok(result.palette.every(color => preset.colors.includes(color)), mode);
      }
      assert.equal((R.exportSVG(result).match(/<rect /g) || []).length, 1024);
      let painted = 0;
      const context = { fillStyle: "", fillRect() { assert.ok(result.palette.includes(this.fillStyle)); painted++; } };
      R.paintExport({ getContext: () => context }, result);
      assert.equal(painted, 1024);
    }
    assert.throws(() => solid([10, 20, 30, 255], { palette: mode, colors: preset.max + 1 }));
  }
  for (const colors of [0, 1, 2.5, "bad", 65]) assert.throws(() => solid([0, 0, 0, 255], { colors }));
});

test("reduced palettes retain minority hue families and grayscale ignores hue", () => {
  const data = pixels(10, 10, x => [...rgb(R.PALETTE[x < 7 ? 11 : 0]), 255]);
  const result = R.rasterizePixels(data, 10, 10, { grid: 10, palette: "vibrant", colors: 2 });
  assert.deepEqual(used(result), new Set([R.PALETTE[0], R.PALETTE[11]]));
  const gray = solid([0, 120, 255, 255], { palette: "grayscale", colors: 16 });
  assert.ok(gray.palette.every(color => { const [r, g, b] = rgb(color); return r === g && g === b; }));
});
test("reduced Rainbow spans the spectrum through purple independently of source frequencies", () => {
  const spectrum = ["#FF0000", "#FF8000", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#BF00FF"];
  // A source without purple must not remove it from the named Rainbow palette.
  for (let colors = 2; colors <= 24; colors++) {
    const result = solid([255, 128, 0, 255], { palette: "rainbow", colors });
    assert.equal(result.palette.length, colors);
    assert.equal(new Set(result.palette).size, colors);
    assert.ok(result.palette.includes("#000000") && result.palette.includes("#FFFFFF"));
    if (colors >= 4) assert.ok(result.palette.includes(spectrum[0]) && result.palette.includes(spectrum[6]));
    if (colors >= 9) spectrum.forEach(color => assert.ok(result.palette.includes(color), `${colors}: ${color}`));
    if (colors === 9) assert.deepEqual(result.palette, ["#000000", "#FFFFFF", ...spectrum]);
  }
  // Even a thin purple stripe on a predominantly warm image retains its hue.
  const data = pixels(25, 25, x => [...rgb(x === 24 ? "#BF00FF" : "#FF8000"), 255]);
  const result = R.rasterizePixels(data, 25, 25, { grid: 25, palette: "rainbow", colors: 9 });
  assert.equal(result.palette[result.cells[24]], "#BF00FF");
  assert.equal(result.counts[result.palette.indexOf("#BF00FF")], 25);
});

test("mirror reverses rows after conversion without changing palette or counts", () => {
  const data = pixels(5, 5, (x, y) => [...rgb(R.PALETTE[(y * 5 + x) % 20]), 255]);
  for (const palette of ["studio", "image"]) {
    const original = R.rasterizePixels(data, 5, 5, { grid: 5, palette });
    const mirrored = R.rasterizePixels(data, 5, 5, { grid: 5, palette, mirror: true });
    for (let y = 0; y < 5; y++) assert.deepEqual(mirrored.cells.slice(y * 5, y * 5 + 5), original.cells.slice(y * 5, y * 5 + 5).reverse());
    assert.deepEqual(mirrored.counts, original.counts); assert.deepEqual(mirrored.palette, original.palette);
  }
});
test("independent grid axes sample every rectangular tile and export the same layout", () => {
  const data = pixels(40, 50, (x, y) => [x * 4, y * 4, 0, 255]);
  const result = R.rasterizePixels(data, 40, 50, { grid: 5, gridRows: 8, palette: "image", colors: 64 });
  assert.deepEqual([result.columns, result.rows, result.cells.length], [5, 8, 40]);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 5; col++) {
    assert.deepEqual(rgb(result.palette[result.cells[row * 5 + col]]), [col * 32 + 14, row * 20 + 28, 0]);
  }
  const mirrored = R.rasterizePixels(data, 40, 50, { grid: 5, gridRows: 8, palette: "image", colors: 64, mirror: true });
  for (let row = 0; row < 8; row++) assert.deepEqual(mirrored.cells.slice(row * 5, row * 5 + 5), result.cells.slice(row * 5, row * 5 + 5).reverse());
  const svg = R.exportSVG({ ...result, width_cm: 11, height_cm: 11 });
  assert.match(svg, /viewBox="0 0 5 8"/);
  assert.equal((svg.match(/<rect /g) || []).length, 40);
  assert.match(svg, /<rect x="4" y="7"/);
});

test("invalid settings, crop, dimensions and pixel data are rejected", () => {
  const data = pixels(5, 5, () => [0, 0, 0, 255]);
  for (const options of [{ grid: 4 }, { grid: 21.5 }, { grid: "nan" }, { gridRows: 4 }, { gridRows: 65 }, { gridRows: 7.5 }, { gridRows: "nan" }, { shape: "hexagon", gridRows: 75 }, { palette: "bad" }, { fit: "bad" }, { mirror: "false" },
    { vibrance: 101 }, { brightness: "nan" }, { contrast: -101 }, { crop: [] }, { crop: [1, 0, .5, 1] }, { crop: [-.1, 0, 1, 1] }]) {
    assert.throws(() => R.rasterizePixels(data, 5, 5, options));
  }
  assert.throws(() => R.rasterizePixels(data, 5001, 5000));
  assert.throws(() => R.rasterizePixels(data.slice(1), 5, 5));
});
test("SVG uses exact physical dimensions, cells, paint changes and palette grid color", () => {
  const result = solid([0, 0, 0, 255]);
  const editor = new MosaicEditor(result.cells, 20); editor.beginStroke(18); editor.paint(0); editor.endStroke(); editor.mirrorHorizontal(5);
  const svg = R.exportSVG({ ...result, width_cm: 5, height_cm: 10, show_grid: true });
  assert.match(svg, /width="5cm" height="10cm"/); assert.match(svg, /viewBox="0 0 5 5"/);
  assert.equal((svg.match(/<rect /g) || []).length, 25);
  assert.match(svg, /<rect x="4" y="0" width="1" height="1" fill="#FFFFFF"/);
  assert.match(svg, /stroke="#000000"/);
});
test("PNG paints opaque integer rectangles using at most the palette colors", () => {
  const result = solid([255, 255, 255, 255]), calls = [], context = { fillStyle: "", fillRect(...args) { calls.push({ color: this.fillStyle, args }); } };
  const canvas = { getContext: () => context };
  R.paintExport(canvas, { ...result, show_grid: true });
  assert.deepEqual([canvas.width, canvas.height], [1299, 1299]);
  assert.equal(calls.length, 25 + 8);
  calls.forEach(call => { assert.ok(result.palette.includes(call.color)); assert.ok(call.args.every(Number.isInteger)); });
  assert.deepEqual(R.pngDimensions({ ...result, width_cm: 5, height_cm: 10 }), [591, 1181]);
});
test("export validation prevents invalid sizes, palette strings and grid cells", () => {
  const base = solid([0, 0, 0, 255]);
  for (const patch of [{ width_cm: 0 }, { height_cm: "nan" }, { palette: ["#FFFFFF"] }, { palette: Array(20).fill('<script>') },
    { cells: Array(25).fill(20) }, { cells: Array(25).fill(true) }, { cells: [] }, { show_grid: "false" }]) assert.throws(() => R.exportSVG({ ...base, ...patch }));
});
