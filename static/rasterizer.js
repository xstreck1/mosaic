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
    const white = full.indexOf("#FFFFFF"), selected = [];
    if (preset === PRESETS.rainbow) {
      // A reduced Rainbow must still span red through purple, even when the
      // source contains little or no purple. Nine slots hold all seven hues
      // at their vivid middle tone plus black and white; extra slots add shades.
      selected.push(0, white);
      const hues = Math.min(7, limit - 2);
      for (let i = 0; i < hues; i++) {
        const family = hues === 1 ? 0 : Math.round(i * 6 / (hues - 1));
        selected.push(4 + family * 3);
      }
    } else {
      // Keep white backgrounds, then select colors by source-weighted coverage.
      if (white >= 0 && samples.some(color => color.every(v => v === 255))) selected.push(white);
      if (!selected.length) selected.push(weights.indexOf(Math.max(...weights)));
    }
    const distances = entries.map(entry => Math.min(...selected.map(i => cost(entry, entries[i]))));
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
    const grid_shape = options.shape ?? "square";
    if (!["square", "hexagon"].includes(grid_shape)) throw new Error("Choose a valid grid shape.");
    if (typeof mirror !== "boolean") throw new Error("Choose a valid mirror setting.");
    if (!Object.hasOwn(PRESETS, mode) || !["cover", "contain"].includes(fit)) throw new Error("Choose a valid palette and framing mode.");
    const color_count = number(options.colors ?? Math.min(20, PRESETS[mode].max), "Color limit", 2, PRESETS[mode].max, true);
    const [left, top, right, bottom] = cropBounds(width, height, options.crop);
    return { ...gridLayout(size, grid_shape), grid_size: size, grid_shape, palette_mode: mode, color_count, fit_mode: fit, mirror, adjustments: adjustmentsFor(options),
      source_size: [width, height], crop_size: [right - left, bottom - top],
      crop: options.crop == null ? null : [left / width, top / height, right / width, bottom / height] };
  }

  function gridLayout(size, shape = "square") {
    return shape === "hexagon" ? { columns: size, rows: Math.round(size * 2 / Math.sqrt(3)) } : { columns: size, rows: size };
  }

  // Normalized geometry is shared by sampling, preview, pointer picking and exports.
  // Fit complete hexagons inside the rectangle, leaving a scalloped transparent border.
  // Staggered rows reflect with edits.
  function cellPolygon(grid, index) {
    const col = index % grid.columns, row = Math.floor(index / grid.columns);
    if (grid.grid_shape !== "hexagon") return [[col, row], [col + 1, row], [col + 1, row + 1], [col, row + 1]]
      .map(([x, y]) => [x / grid.columns, y / grid.rows]);
    const offset = (row % 2 ? .25 : -.25) * (grid.mirror ? -1 : 1);
    const cx = col + .75 + offset, cy = row * .75 + .5, width = grid.columns + .5, height = (grid.rows - 1) * .75 + 1;
    return [[0, -.5], [.5, -.25], [.5, .25], [0, .5], [-.5, .25], [-.5, -.25]]
      .map(([x, y]) => [(cx + x) / width, (cy + y) / height]);
  }

  function clipPolygon(points, axis, boundary, greater) {
    const output = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const insideA = greater ? a[axis] >= boundary : a[axis] <= boundary;
      const insideB = greater ? b[axis] >= boundary : b[axis] <= boundary;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = (boundary - a[axis]) / (b[axis] - a[axis]);
        output.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    return output;
  }

  function clippedCell(grid, index) {
    let points = cellPolygon(grid, index);
    for (const [axis, boundary, greater] of [[0, 0, true], [0, 1, false], [1, 0, true], [1, 1, false]])
      points = clipPolygon(points, axis, boundary, greater);
    return points;
  }

  function polygonArea(points) {
    let area = 0;
    points.forEach((a, i) => { const b = points[(i + 1) % points.length]; area += a[0] * b[1] - b[0] * a[1]; });
    return Math.abs(area) / 2;
  }

  function cellAtPoint(grid, x, y) {
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return null;
    if (grid.grid_shape !== "hexagon") return Math.floor(y * grid.rows) * grid.columns + Math.floor(x * grid.columns);
    const nearRow = Math.round((y * ((grid.rows - 1) * .75 + 1) - .5) / .75);
    for (let row = Math.max(0, nearRow - 1); row <= Math.min(grid.rows - 1, nearRow + 1); row++) {
      const offset = (row % 2 ? .25 : -.25) * (grid.mirror ? -1 : 1);
      const nearCol = Math.round(x * (grid.columns + .5) - .75 - offset);
      for (let col = Math.max(0, nearCol - 1); col <= Math.min(grid.columns - 1, nearCol + 1); col++) {
        const index = row * grid.columns + col, points = cellPolygon(grid, index);
        if (points.every((a, i) => { const b = points[(i + 1) % points.length]; return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-12; })) return index;
      }
    }
    return null;
  }

  // Exact pixel coverage for a scanline band whose polygon edges are linear.
  function bandArea(l0, l1, r0, r1, x0, x1, height) {
    if (Math.max(l0, l1) <= x0 && Math.min(r0, r1) >= x1) return (x1 - x0) * height;
    const splits = [0, 1];
    for (const [a, b] of [[l0, l1], [r0, r1]]) if (a !== b)
      for (const x of [x0, x1]) { const t = (x - a) / (b - a); if (t > 0 && t < 1) splits.push(t); }
    splits.sort((a, b) => a - b);
    let area = 0;
    for (let i = 1; i < splits.length; i++) {
      const t = (splits[i] + splits[i - 1]) / 2;
      area += Math.max(0, Math.min(x1, r0 + (r1 - r0) * t) - Math.max(x0, l0 + (l1 - l0) * t)) * (splits[i] - splits[i - 1]) * height;
    }
    return area;
  }

  function hexSamples(data, width, bounds, side, originX, originY, settings, adjust) {
    const [left, top, right, bottom] = bounds;
    const dx = side / (settings.columns + .5), dy = side / ((settings.rows - 1) * .75 + 1), samples = [];
    const grid = { ...settings, mirror: false };
    for (let index = 0; index < grid.columns * grid.rows; index++) {
      const points = cellPolygon(grid, index), cx = originX + points[0][0] * side, cy = originY + (points[0][1] * side + dy / 2);
      const area = polygonArea(clippedCell(grid, index)) * side * side;
      let red = 255 * area, green = red, blue = red;
      const halfWidth = y => dx * Math.min(.5, Math.max(0, 1 - 2 * Math.abs((y - cy) / dy)));
      for (let y = Math.max(top, Math.floor(cy - dy / 2), Math.floor(originY)); y < Math.min(bottom, Math.ceil(cy + dy / 2), Math.ceil(originY + side)); y++) {
        const y0 = Math.max(y, cy - dy / 2, originY), y1 = Math.min(y + 1, cy + dy / 2, originY + side);
        if (y1 <= y0) continue;
        const bands = [y0, ...[cy - dy / 4, cy + dy / 4].filter(v => v > y0 && v < y1), y1];
        for (let b = 1; b < bands.length; b++) {
          const a = bands[b - 1], z = bands[b], h0 = halfWidth(a), h1 = halfWidth(z);
          const l0 = cx - h0, l1 = cx - h1, r0 = cx + h0, r1 = cx + h1;
          for (let x = Math.max(left, Math.floor(Math.min(l0, l1)), Math.floor(originX)); x < Math.min(right, Math.ceil(Math.max(r0, r1)), Math.ceil(originX + side)); x++) {
            const weight = bandArea(l0, l1, r0, r1, Math.max(x, originX), Math.min(x + 1, originX + side), z - a) * data[(y * width + x) * 4 + 3] / 255;
            if (!weight) continue;
            const i = (y * width + x) * 4, color = adjust(data[i], data[i + 1], data[i + 2]);
            red += ((color >> 16) - 255) * weight; green += (((color >> 8) & 255) - 255) * weight; blue += ((color & 255) - 255) * weight;
          }
        }
      }
      samples.push([clamp(red / area), clamp(green / area), clamp(blue / area)]);
    }
    return samples;
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
    const { grid_size: size, columns, rows, palette_mode: mode, color_count: limit, fit_mode: fit, mirror, adjustments } = settings;
    const bounds = cropBounds(width, height, options.crop), [left, top, right, bottom] = bounds;
    const cw = right - left, ch = bottom - top, side = fit === "cover" ? Math.min(cw, ch) : Math.max(cw, ch);
    // Sample in original pixel coordinates. Outside a contained image is white.
    const originX = left + (cw - side) / 2, originY = top + (ch - side) / 2, cellSide = side / size;
    const adjust = colorAdjuster(adjustments);
    const samples = settings.grid_shape === "hexagon" ? hexSamples(data, width, bounds, side, originX, originY, settings, adjust) : [];
    for (let row = 0; settings.grid_shape === "square" && row < size; row++) {
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
    if (mirror) cells = cells.flatMap((_, i) => i % columns === 0 ? cells.slice(i, i + columns).reverse() : []);
    const counts = Array(palette.length).fill(0); cells.forEach(i => counts[i]++);
    return { ...settings, cells, palette, counts,
      palette_names: names,
      grid_color: darkest(palette),
      used_colors: new Set(cells.map(i => palette[i])).size };
  }

  function darkest(palette) { return palette.reduce((best, color) => lab(rgb(color))[0] < lab(rgb(best))[0] ? color : best); }

  function validateExport(payload) {
    if (!payload || typeof payload !== "object") throw new Error("Invalid export data.");
    const grid_shape = payload.grid_shape ?? "square", mirror = payload.mirror ?? false;
    if (!["square", "hexagon"].includes(grid_shape) || typeof mirror !== "boolean") throw new Error("Invalid grid shape or mirror setting.");
    const columns = number(payload.columns, "Columns", 5, grid_shape === "hexagon" ? 65 : 64, true), rows = number(payload.rows, "Rows", 5, grid_shape === "hexagon" ? 75 : 64, true);
    const width_cm = number(payload.width_cm ?? 11, "Width", 1, 50), height_cm = number(payload.height_cm ?? 11, "Height", 1, 50);
    if (!Array.isArray(payload.palette) || payload.palette.length < 1 || payload.palette.length > 64 || payload.palette.some(c => typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c))) throw new Error("Choose a valid palette with 1 to 64 colors.");
    if (!Array.isArray(payload.cells) || payload.cells.length !== columns * rows || payload.cells.some(i => !Number.isInteger(i) || i < 0 || i >= payload.palette.length)) throw new Error("Invalid mosaic cells.");
    if (payload.show_grid !== undefined && typeof payload.show_grid !== "boolean") throw new Error("Invalid grid option.");
    return { ...payload, columns, rows, grid_shape, mirror, width_cm, height_cm, show_grid: payload.show_grid ?? false };
  }

  function exportSVG(payload) {
    const p = validateExport(payload), { columns, rows, width_cm, height_cm, cells, palette } = p;
    if (p.grid_shape === "hexagon") {
      const polygons = cells.map((cell, i) => `<polygon points="${cellPolygon(p, i).map(point => point.map(v => +v.toFixed(9)).join(",")).join(" ")}" fill="${palette[cell]}" stroke="${palette[cell]}" stroke-width="${.0125 / columns}" stroke-linejoin="round"/>`).join("");
      const lines = p.show_grid ? cells.map((_, i) => `<polygon points="${cellPolygon(p, i).map(point => point.map(v => +v.toFixed(9)).join(",")).join(" ")}"/>`).join("") : "";
      return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width_cm}cm" height="${height_cm}cm" viewBox="0 0 1 1" preserveAspectRatio="none" overflow="hidden"><title>Mosaic — ${cells.length} hexagons, ${width_cm} × ${height_cm} cm</title>${polygons}${lines ? `<g fill="none" stroke="${darkest(palette)}" stroke-width="${.025 / columns}">${lines}</g>` : ""}</svg>`;
    }
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
    return paintMosaic(canvas, p);
  }

  function paintMosaic(canvas, p) {
    const width = canvas.width, height = canvas.height;
    const ctx = canvas.getContext("2d");
    if (p.grid_shape === "hexagon") {
      ctx.clearRect(0, 0, width, height);
      const path = points => {
        ctx.beginPath();
        points.forEach(([x, y], i) => i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height));
        ctx.closePath();
      };
      // A hairline of each tile's own color prevents antialiasing seams.
      ctx.lineWidth = .7; ctx.lineJoin = "round";
      p.cells.forEach((cell, i) => {
        path(cellPolygon(p, i)); ctx.fillStyle = p.palette[cell]; ctx.strokeStyle = p.palette[cell]; ctx.fill(); ctx.stroke();
      });
      if (p.show_grid) {
        ctx.strokeStyle = darkest(p.palette);
        ctx.lineWidth = Math.max(.5, Math.min(width / (p.columns + .5), height / ((p.rows - 1) * .75 + 1)) * .025);
        p.cells.forEach((_, i) => { path(cellPolygon(p, i)); ctx.stroke(); });
      }
      return canvas;
    }
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

  return { PALETTE, NAMES, PRESETS, lab, cropBounds, imageSettings, gridLayout, cellPolygon, clippedCell, cellAtPoint, adjustPixels, rasterizePixels, validateExport, exportSVG, pngDimensions, paintExport, paintMosaic };
});
