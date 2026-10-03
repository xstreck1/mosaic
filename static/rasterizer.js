"use strict";

// Pure pixel processing shared by the browser worker and Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MosaicRasterizer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PALETTE = ["#DA0D0B", "#F82A5A", "#FB93A2", "#F94F0A", "#FB9A13",
    "#E7CB40", "#A03518", "#EAB27D", "#1CB56D", "#81D342", "#2BAEC6", "#1B469A",
    "#1B82CB", "#291849", "#73349A", "#866ABE", "#000000", "#7C8080", "#FFFFFF", "#3D3D3F"];
  const NAMES = ["Red", "Hot pink", "Light pink", "Orange", "Golden yellow", "Yellow", "Brown", "Peach",
    "Green", "Lime", "Turquoise", "Royal blue", "Sky blue", "Deep purple", "Violet", "Lavender",
    "Black", "Gray", "White", "Black & white mix (flat approximation)"];
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const hex = color => "#" + color.map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));

  function hsl(hue, saturation, lightness) {
    const a = saturation * Math.min(lightness, 1 - lightness);
    return hex([0, 8, 4].map(offset => {
      const k = (offset + hue / 30) % 12;
      return 255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    }));
  }
  const PRESETS = {
    image: { label: "From image", max: 64 },
    vibrant: { label: "Vibrant", max: 20, colors: PALETTE, names: NAMES },
    pastel: { label: "Pastel", max: 24, colors: ["#000000", "#FFFFFF", "#AAA8AC",
      ...[0, 30, 60, 120, 180, 240, 300].flatMap(hue => [.72, .82, .9].map(lightness => hsl(hue, .55, lightness)))] },
    neon: { label: "Neon", max: 16, colors: ["#000000", "#FFFFFF", "#303030", "#BFBFBF",
      ...Array.from({ length: 12 }, (_, i) => hsl(i * 30, 1, .55))] },
    grayscale: { label: "Grayscale", max: 16, colors: Array.from({ length: 16 }, (_, i) => {
      // Even CIE Lab lightness steps, rather than equal sRGB byte steps.
      const l = i * 100 / 15, y = l > 8 ? ((l + 16) / 116) ** 3 : l / (24389 / 27);
      const value = clamp(255 * (y <= .0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - .055));
      return hex([value, value, value]);
    }) },
    rainbow: { label: "Rainbow", max: 24, colors: ["#000000", "#808080", "#FFFFFF",
      ...[0, 30, 60, 120, 180, 240, 285].flatMap(hue => [.35, .5, .7].map(lightness => hsl(hue, 1, lightness)))] },
    // Colodore's default VIC-II model: https://www.pepto.de/projects/colorvic/
    commodore64: { label: "Commodore 64", max: 16,
      colors: ["#000000", "#FFFFFF", "#813338", "#75CEC8", "#8E3C97", "#56AC4D", "#2E2C9B", "#EDF171",
        "#8E5029", "#553800", "#C46C71", "#4A4A4A", "#7B7B7B", "#A9FF9F", "#706DEB", "#B2B2B2"],
      names: ["Black", "White", "Red", "Cyan", "Purple", "Green", "Blue", "Yellow", "Orange", "Brown",
        "Light red", "Dark gray", "Gray", "Light green", "Light blue", "Light gray"] }
  };

  function number(value, name, min, max, integer = false) {
    if (value === null || value === "" || typeof value === "boolean") throw new Error(`${name} must be a number.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      throw new Error(`${name} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`);
    }
    return n;
  }

  function lab(color) {
    const [r, g, b] = color.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
    const xyz = [(r * .4124564 + g * .3575761 + b * .1804375) / .95047,
      r * .2126729 + g * .7151522 + b * .072175,
      (r * .0193339 + g * .119192 + b * .9503041) / 1.08883];
    const [x, y, z] = xyz.map(v => v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function hueColor(color) {
    const [r, g, b] = color, max = Math.max(...color), min = Math.min(...color), chroma = max - min;
    let hue = 0;
    if (chroma) {
      hue = max === r ? (g - b) / chroma : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return { hue, saturation: max ? chroma / max : 0, chroma, lightness: lab(color)[0] };
  }
  const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  function referenceMatcher(palette, grayscale = false) {
    const entries = palette.map(color => hueColor(rgb(color)));
    const neutrals = entries.map((entry, i) => entry.chroma <= 10 || entry.saturation < .08 ? i : -1).filter(i => i >= 0);
    const colored = entries.map((_, i) => i).filter(i => !neutrals.includes(i));
    return color => {
      const value = hueColor(color);
      const neutral = value.chroma <= 10 || value.saturation < .08;
      let best = 0, distance = Infinity;
      if (grayscale || !colored.length || neutral && neutrals.length) {
        for (const i of grayscale || !neutrals.length ? entries.map((_, i) => i) : neutrals) {
          const delta = (entries[i].lightness - value.lightness) ** 2;
          if (delta < distance) { distance = delta; best = i; }
        }
        return best;
      }
      const hues = colored.map(i => hueDistance(entries[i].hue, value.hue));
      const nearestHue = Math.min(...hues);
      // First restrict candidates to nearby hues. Tone and saturation then select
      // a shade within that family; gray cannot replace a visibly colored sample.
      for (let i = 0; i < hues.length; i++) {
        if (hues[i] > nearestHue + 12) continue;
        const entry = entries[colored[i]];
        const delta = .25 * hues[i] ** 2 + (entry.lightness - value.lightness) ** 2
          + .25 * ((entry.saturation - value.saturation) * 100) ** 2;
        if (delta < distance) { distance = delta; best = colored[i]; }
      }
      return best;
    };
  }

  function fixedPalette(samples, preset, limit) {
    const full = preset.colors, matcher = referenceMatcher(full, preset === PRESETS.grayscale);
    const assignments = samples.map(matcher);
    if (limit === full.length) return { palette: full.slice(), cells: assignments,
      names: preset.names?.slice() || [] };
    const weights = Array(full.length).fill(0); assignments.forEach(i => weights[i]++);
    const entries = full.map(color => hueColor(rgb(color)));
    const cost = (a, b) => {
      const lightness = (a.lightness - b.lightness) ** 2;
      const neutralA = a.chroma <= 10 || a.saturation < .08, neutralB = b.chroma <= 10 || b.saturation < .08;
      if (preset === PRESETS.grayscale || neutralA && neutralB) return lightness;
      if (neutralA !== neutralB) return lightness + 20000;
      return lightness + 2 * hueDistance(a.hue, b.hue) ** 2 + 2500 * (a.saturation - b.saturation) ** 2;
    };
    // Keep a white background when the source includes pure white (including
    // flattened transparency). Add colors by weighted coverage, so reducing
    // the limit keeps dominant hues without filling every slot with one shade.
    const white = full.indexOf("#FFFFFF"), selected = [];
    if (white >= 0 && samples.some(color => color.every(v => v === 255))) selected.push(white);
    if (!selected.length) selected.push(weights.indexOf(Math.max(...weights)));
    const distances = entries.map(entry => cost(entry, entries[selected[0]]));
    while (selected.length < limit) {
      let best = -1, improvement = -Infinity;
      entries.forEach((entry, i) => {
        if (selected.includes(i)) return;
        const gain = entries.reduce((sum, source, j) => sum + weights[j] * Math.max(0, distances[j] - cost(source, entry)), 0);
        if (gain > improvement) { best = i; improvement = gain; }
      });
      selected.push(best);
      entries.forEach((entry, i) => { distances[i] = Math.min(distances[i], cost(entry, entries[best])); });
    }
    selected.sort((a, b) => a - b);
    const palette = selected.map(i => full[i]), match = referenceMatcher(palette, preset === PRESETS.grayscale);
    return { palette, cells: samples.map(match), names: preset.names ? selected.map(i => preset.names[i]) : [] };
  }

  function adjustmentsFor(options) {
    return Object.fromEntries(["vibrance", "brightness", "contrast"].map(name => [name, number(options[name] ?? 0, name, -100, 100)]));
  }

  function colorAdjuster(adjustments) {
    const vibrance = adjustments.vibrance / 100, gain = 1 + adjustments.brightness / 100, spread = 1 + adjustments.contrast / 100;
    const tonal = Array.from({ length: 256 }, (_, v) => clamp((v * gain - 128) * spread + 128));
    return (r, g, b) => {
      if (vibrance) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b), saturation = max ? (max - min) / max : 0;
        const factor = 1 + vibrance * (1 - saturation);
        r = clamp(max + (r - max) * factor); g = clamp(max + (g - max) * factor); b = clamp(max + (b - max) * factor);
      }
      return (tonal[r] << 16) | (tonal[g] << 8) | tonal[b];
    };
  }

  function adjustPixels(data, options = {}, inPlace = false) {
    const output = inPlace ? data : new Uint8ClampedArray(data), adjust = colorAdjuster(adjustmentsFor(options));
    for (let i = 0; i < output.length; i += 4) {
      if (!output[i + 3]) continue;
      const color = adjust(output[i], output[i + 1], output[i + 2]);
      output[i] = color >> 16; output[i + 1] = (color >> 8) & 255; output[i + 2] = color & 255;
    }
    return output;
  }

  function imageSettings(width, height, options = {}) {
    number(width, "Image width", 1, 25000000, true); number(height, "Image height", 1, 25000000, true);
    if (width * height > 25000000) throw new Error("The image must be no larger than 25 megapixels.");
    const size = number(options.grid ?? 21, "Grid size", 5, 64, true), mode = options.palette === "studio" ? "vibrant" : options.palette ?? "vibrant", fit = options.fit ?? "cover", mirror = options.mirror ?? false;
    if (typeof mirror !== "boolean") throw new Error("Choose a valid mirror setting.");
    if (!Object.hasOwn(PRESETS, mode) || !["cover", "contain"].includes(fit)) throw new Error("Choose a valid palette and framing mode.");
    const color_count = number(options.colors ?? Math.min(20, PRESETS[mode].max), "Color limit", 2, PRESETS[mode].max, true);
    const [left, top, right, bottom] = cropBounds(width, height, options.crop);
    return { columns: size, rows: size, palette_mode: mode, color_count, fit_mode: fit, mirror, adjustments: adjustmentsFor(options),
      source_size: [width, height], crop_size: [right - left, bottom - top],
      crop: options.crop == null ? null : [left / width, top / height, right / width, bottom / height] };
  }

  function cropBounds(width, height, crop) {
    if (crop == null) return [0, 0, width, height];
    if (!Array.isArray(crop) || crop.length !== 4) throw new Error("Choose a valid crop rectangle.");
    const c = crop.map(v => number(v, "Crop coordinate", 0, 1));
    if (c[0] >= c[2] || c[1] >= c[3]) throw new Error("Choose a crop with positive width and height.");
    const left = Math.min(width - 1, Math.round(c[0] * width)), top = Math.min(height - 1, Math.round(c[1] * height));
    return [left, top, Math.max(left + 1, Math.round(c[2] * width)), Math.max(top + 1, Math.round(c[3] * height))];
  }

  function adaptivePalette(samples, limit) {
    const histogram = new Map();
    for (const color of samples) {
      const key = color.join(","), entry = histogram.get(key);
      if (entry) entry.count++;
      else histogram.set(key, { color, count: 1 });
    }
    function box(entries) {
      const ranges = [0, 1, 2].map(c => Math.max(...entries.map(e => e.color[c])) - Math.min(...entries.map(e => e.color[c])));
      const axis = ranges.indexOf(Math.max(...ranges)), count = entries.reduce((sum, e) => sum + e.count, 0);
      return { entries, axis, count, score: ranges[axis] * count };
    }
    const boxes = [box([...histogram.values()])];
    while (boxes.length < limit) {
      let index = -1;
      boxes.forEach((b, i) => { if (b.entries.length > 1 && (index < 0 || b.score > boxes[index].score)) index = i; });
      if (index < 0) break;
      const current = boxes[index], entries = current.entries.slice().sort((a, b) => a.color[current.axis] - b.color[current.axis]);
      let split = 0, count = 0;
      while (split < entries.length - 1 && count < current.count / 2) count += entries[split++].count;
      boxes.splice(index, 1, box(entries.slice(0, split)), box(entries.slice(split)));
    }
    const palette = [], mapping = new Map();
    boxes.forEach((b, i) => {
      const color = hex([0, 1, 2].map(c => b.entries.reduce((sum, e) => sum + e.color[c] * e.count, 0) / b.count));
      let index = palette.indexOf(color);
      if (index < 0) { index = palette.length; palette.push(color); }
      b.entries.forEach(e => mapping.set(e.color.join(","), index));
    });
    const cells = samples.map(color => mapping.get(color.join(",")));
    return { palette, cells };
  }

  function rasterizePixels(data, width, height, options = {}) {
    const settings = imageSettings(width, height, options);
    if (!data || data.length !== width * height * 4) throw new Error("Invalid image pixels.");
    const { columns: size, palette_mode: mode, color_count: limit, fit_mode: fit, mirror, adjustments } = settings;
    const bounds = cropBounds(width, height, options.crop), [left, top, right, bottom] = bounds;
    const cw = right - left, ch = bottom - top, side = fit === "cover" ? Math.min(cw, ch) : Math.max(cw, ch);
    // Sample in original pixel coordinates. Outside a contained image is white.
    const originX = left + (cw - side) / 2, originY = top + (ch - side) / 2, cellSide = side / size;
    const adjust = colorAdjuster(adjustments);
    const samples = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const x0 = originX + col * cellSide, x1 = x0 + cellSide, y0 = originY + row * cellSide, y1 = y0 + cellSide;
        const area = cellSide * cellSide;
        let red = 255 * area, green = red, blue = red;
        for (let y = Math.max(top, Math.floor(y0)); y < Math.min(bottom, Math.ceil(y1)); y++) {
          const wy = Math.min(y + 1, y1) - Math.max(y, y0);
          for (let x = Math.max(left, Math.floor(x0)); x < Math.min(right, Math.ceil(x1)); x++) {
            const i = (y * width + x) * 4, alpha = data[i + 3] / 255;
            if (!alpha) continue;
            const color = adjust(data[i], data[i + 1], data[i + 2]);
            const weight = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy * alpha;
            red += ((color >> 16) - 255) * weight; green += (((color >> 8) & 255) - 255) * weight; blue += ((color & 255) - 255) * weight;
          }
        }
        samples.push([clamp(red / area), clamp(green / area), clamp(blue / area)]);
      }
    }
    let palette, cells, names = [];
    if (mode === "image") ({ palette, cells } = adaptivePalette(samples, limit));
    else ({ palette, cells, names } = fixedPalette(samples, PRESETS[mode], limit));
    if (mirror) cells = cells.flatMap((_, i) => i % size === 0 ? cells.slice(i, i + size).reverse() : []);
    const counts = Array(palette.length).fill(0); cells.forEach(i => counts[i]++);
    return { ...settings, cells, palette, counts,
      palette_names: names,
      grid_color: darkest(palette),
      used_colors: new Set(cells.map(i => palette[i])).size };
  }

  function darkest(palette) { return palette.reduce((best, color) => lab(rgb(color))[0] < lab(rgb(best))[0] ? color : best); }

  function validateExport(payload) {
    if (!payload || typeof payload !== "object") throw new Error("Invalid export data.");
    const columns = number(payload.columns, "Columns", 5, 64, true), rows = number(payload.rows, "Rows", 5, 64, true);
    const width_cm = number(payload.width_cm ?? 11, "Width", 1, 50), height_cm = number(payload.height_cm ?? 11, "Height", 1, 50);
    if (!Array.isArray(payload.palette) || payload.palette.length < 1 || payload.palette.length > 64 || payload.palette.some(c => typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c))) throw new Error("Choose a valid palette with 1 to 64 colors.");
    if (!Array.isArray(payload.cells) || payload.cells.length !== columns * rows || payload.cells.some(i => !Number.isInteger(i) || i < 0 || i >= payload.palette.length)) throw new Error("Invalid mosaic cells.");
    if (payload.show_grid !== undefined && typeof payload.show_grid !== "boolean") throw new Error("Invalid grid option.");
    return { ...payload, columns, rows, width_cm, height_cm, show_grid: payload.show_grid ?? false };
  }

  function exportSVG(payload) {
    const p = validateExport(payload), { columns, rows, width_cm, height_cm, cells, palette } = p;
    let svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width_cm}cm" height="${height_cm}cm" viewBox="0 0 ${columns} ${rows}" preserveAspectRatio="none" shape-rendering="crispEdges">`;
    svg += `<title>Mosaic — ${columns} × ${rows} squares, ${width_cm} × ${height_cm} cm</title>`;
    cells.forEach((cell, i) => { svg += `<rect x="${i % columns}" y="${Math.floor(i / columns)}" width="1" height="1" fill="${palette[cell]}"/>`; });
    if (p.show_grid) {
      const commands = [];
      for (let x = 1; x < columns; x++) commands.push(`M ${x} 0 V ${rows}`);
      for (let y = 1; y < rows; y++) commands.push(`M 0 ${y} H ${columns}`);
      svg += `<path d="${commands.join(" ")}" fill="none" stroke="${darkest(palette)}" stroke-width="0.025"/>`;
    }
    return svg + "</svg>";
  }

  function pngDimensions(payload) {
    const p = validateExport(payload);
    return [Math.round(p.width_cm / 2.54 * 300), Math.round(p.height_cm / 2.54 * 300)];
  }

  function paintExport(canvas, payload) {
    const p = validateExport(payload), [width, height] = pngDimensions(p);
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    p.cells.forEach((cell, i) => {
      const x = i % p.columns, y = Math.floor(i / p.columns), left = Math.round(x * width / p.columns), top = Math.round(y * height / p.rows);
      ctx.fillStyle = p.palette[cell];
      ctx.fillRect(left, top, Math.round((x + 1) * width / p.columns) - left, Math.round((y + 1) * height / p.rows) - top);
    });
    if (p.show_grid) {
      ctx.fillStyle = darkest(p.palette);
      const stroke = Math.max(1, Math.round(Math.min(width / p.columns, height / p.rows) * .025));
      for (let x = 1; x < p.columns; x++) ctx.fillRect(Math.round(x * width / p.columns) - Math.floor(stroke / 2), 0, stroke, height);
      for (let y = 1; y < p.rows; y++) ctx.fillRect(0, Math.round(y * height / p.rows) - Math.floor(stroke / 2), width, stroke);
    }
    return canvas;
  }

  return { PALETTE, NAMES, PRESETS, lab, cropBounds, imageSettings, adjustPixels, rasterizePixels, validateExport, exportSVG, pngDimensions, paintExport };
});
