"use strict";

const $ = (id) => document.getElementById(id);
const adjustmentNames = ["vibrance", "brightness", "contrast"];
const paletteButtons = [["imagePalette", "image"], ["studioPalette", "vibrant"], ["pastelPalette", "pastel"],
  ["neonPalette", "neon"], ["grayscalePalette", "grayscale"], ["rainbowPalette", "rainbow"], ["commodore64Palette", "commodore64"]];
const toolButtons = [["brushTool", "brush"], ["pickerTool", "picker"], ["fillTool", "fill"]];
const gridButtons = [["squareGrid", "square"], ["hexagonGrid", "hexagon"], ["circleGrid", "circle"]];
const rasterizer = new BrowserRasterizer();

function updateAdjustments(editingName = null) {
  for (const name of adjustmentNames) {
    const value = Number($(name).value);
    if (name !== editingName) $(name + "Value").value = String(value);
  }
  $("resetAdjustments").disabled = adjustmentNames.every((name) => Number($(name).value) === 0);
}
const state = { source: null, sourceId: 0, sourceSequence: 0, sourceName: "Sunset study", sourceStyle: "Flat illustration", isDemo: true, result: null,
  preview: null, mosaicDirty: true,
  palette: "image", shape: "square", view: "mosaic", linked: true, gridLinked: true, beforeCircle: null, controller: null, revision: 0,
  gallery: [], gallerySequence: 0, selectedGalleryId: null,
  timer: null, noticeTimer: null, busy: false, exporting: false, printing: false, pendingSource: null,
  editor: null, selectedColor: 0, tool: "brush", pointerId: null, lastCell: null,
  crop: null, pendingCrop: undefined, cropDraft: null, cropGesture: null };

function notify(message, error = false) {
  const notice = $("notice");
  notice.textContent = message;
  notice.classList.toggle("error", error);
  notice.hidden = false;
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => { notice.hidden = true; }, error ? 9000 : 4000);
}

function validDimensions() {
  return [$("widthCm"), $("heightCm")].every((input) =>
    input.value !== "" && input.checkValidity() && Number.isFinite(Number(input.value)));
}

function setBusy(busy) {
  if (busy) finishStroke();
  state.busy = busy;
  $("processing").lastChild.textContent = state.view === "original" ? " Updating image…" : " Making mosaic…";
  $("processing").hidden = !busy;
  $("canvasWorkspace").setAttribute("aria-busy", String(busy));
  updateActionButtons();
  $("statusText").replaceChildren();
  const dot = document.createElement("i");
  $("statusText").append(dot, document.createTextNode(busy ? state.view === "original" ? "Updating image…" : "Making mosaic…" :
    state.mosaicDirty && state.preview ? "Select Mosaic to make tiles" : state.result ? "Ready to export" : "Choose an image"));
}

function updateActionButtons() {
  const unavailable = state.busy || state.mosaicDirty || !state.result || !validDimensions();
  $("exportButton").disabled = unavailable;
  $("printButton").disabled = unavailable || state.printing;
  $("cropButton").disabled = state.busy || !state.preview;
  $("resetCropButton").disabled = state.busy || !state.crop;
  updateEditingControls();
}

function updateEditingControls() {
  const unavailable = state.busy || state.mosaicDirty || !state.editor;
  $("swatches").hidden = state.mosaicDirty;
  $("paletteFooter").hidden = state.mosaicDirty;
  $("customColorControls").hidden = state.mosaicDirty;
  $("customColor").disabled = unavailable;
  $("customColorHex").disabled = unavailable;
  $("useCustomColor").disabled = unavailable || !$("customColorHex").value || !$("customColorHex").checkValidity();
  $("transparentColor").disabled = unavailable;
  $("transparentColor").setAttribute("aria-pressed", String(state.selectedColor === -1));
  $("transparentColor").classList.toggle("active", state.selectedColor === -1);
  $("undoButton").disabled = unavailable || !state.editor.canUndo;
  $("redoButton").disabled = unavailable || !state.editor.canRedo;
  $("previewCanvas").classList.toggle("editable", !unavailable && state.view === "mosaic");
  for (const [id, tool] of toolButtons) {
    $(id).disabled = unavailable;
    $(id).classList.toggle("active", state.tool === tool);
    $(id).setAttribute("aria-pressed", String(state.tool === tool));
  }
  for (const button of $("swatches").children) button.disabled = unavailable;
  const edits = state.editor?.undoStack.length || 0;
  const hint = state.tool === "picker" ? "Click a tile to pick its color and return to Brush." :
    state.tool === "fill" ? "Pick a palette color, then click to fill connected tiles of the same color." :
    "Pick a palette color, then click or drag to paint.";
  $("editStatus").textContent = state.mosaicDirty ? "Select Mosaic to calculate tiles, then edit." :
    state.view === "original" ? "Choose a tool or palette color to switch to Mosaic and edit." :
    `${edits ? `${edits} edit${edits === 1 ? "" : "s"} · ` : ""}${hint}`;
}

function updatePaletteUsage() {
  if (!state.result) return;
  const result = state.result;
  $("colorCount").textContent = String(result.palette.length);
  $("paletteTitle").textContent = `Your ${result.palette.length} color${result.palette.length === 1 ? "" : "s"}`;
  $("usedColors").textContent = `${result.used_colors} of ${result.palette.length} colors used`;
  [...$("swatches").children].forEach((button, i) => {
    const selected = i === state.selectedColor;
    const name = result.palette_names[i] || `Color ${i + 1}`;
    const label = `${name} · ${result.palette[i]} · ${result.counts[i]} ${tileName(result, result.counts[i])}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("selected", selected);
    button.classList.toggle("unused", result.counts[i] === 0);
  });
  const transparent = state.selectedColor === -1;
  $("brushSwatch").classList.toggle("transparency-swatch", transparent);
  $("brushSwatch").style.backgroundColor = transparent ? "transparent" : result.palette[state.selectedColor];
  $("brushName").textContent = transparent ? "Clear" : result.palette_names[state.selectedColor] || result.palette[state.selectedColor];
  if (!transparent) {
    $("customColor").value = result.palette[state.selectedColor];
    $("customColorHex").value = result.palette[state.selectedColor].toUpperCase();
  }
}

function tileName(grid, count = 2) {
  const name = grid.grid_shape === "circle" ? "dot" : grid.grid_shape === "hexagon" ? "hexagon" : "square";
  return name + (count === 1 ? "" : "s");
}

function refreshEdits() {
  const result = state.result;
  result.counts = new Array(result.palette.length).fill(0);
  result.cells.forEach((color, i) => { if (result.alphas?.[i] !== 0) result.counts[color]++; });
  result.used_colors = new Set(result.cells.filter((_, i) => result.alphas?.[i] !== 0).map((color) => result.palette[color])).size;
  updatePaletteUsage();
  updateEditingControls();
  drawPreview();
}

function finishStroke() {
  const changed = state.editor?.endStroke();
  const pointer = state.pointerId;
  state.pointerId = null;
  state.lastCell = null;
  const canvas = $("previewCanvas");
  if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  if (changed) refreshEdits();
}

function selectColor(index) {
  if (state.busy || state.mosaicDirty || !state.result) return;
  finishStroke();
  state.selectedColor = index;
  if (state.tool === "picker") state.tool = "brush";
  if (state.view !== "mosaic") setView("mosaic");
  updatePaletteUsage();
  updateEditingControls();
}

function selectTool(tool) {
  if (state.busy || state.mosaicDirty || !state.editor) return;
  finishStroke();
  state.tool = tool;
  if (state.view !== "mosaic") setView("mosaic");
  updateEditingControls();
}

function useCustomColor() {
  if (state.busy || state.mosaicDirty || !state.editor || !$("customColorHex").value || !$("customColorHex").reportValidity()) return;
  const color = "#" + $("customColorHex").value.replace(/^#/, "");
  finishStroke();
  try {
    const result = state.result, previousSize = result.palette.length;
    const index = state.editor.addColor(color, result.palette);
    if (result.palette.length > previousSize) result.palette_names[index] = "Custom color " + result.palette[index];
    state.selectedColor = index;
    if (state.tool === "picker") state.tool = "brush";
    renderSwatches();
    if (state.view !== "mosaic") setView("mosaic");
    refreshEdits();
  } catch (error) { notify(error.message, true); }
}

function historyAction(action) {
  if (state.busy || state.mosaicDirty || !state.editor) return;
  finishStroke();
  if (state.editor[action]()) refreshEdits();
}

function cellAtPointer(event) {
  const bounds = $("previewCanvas").getBoundingClientRect();
  const px = (event.clientX - bounds.left) / bounds.width, py = (event.clientY - bounds.top) / bounds.height;
  const index = MosaicRasterizer.cellAtPoint(state.result, px, py);
  if (index === null) return null;
  return { x: index % state.result.columns, y: Math.floor(index / state.result.columns), px, py, index };
}

function paintToPointer(event) {
  const next = cellAtPointer(event);
  if (!next) { state.lastCell = null; return; }
  if (state.result.grid_shape !== "square") {
    const previous = state.lastCell || next;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(next.px - previous.px) * state.result.columns, Math.abs(next.py - previous.py) * state.result.rows) * 3));
    let changed = false;
    for (let i = 0; i <= steps; i++) {
      const index = MosaicRasterizer.cellAtPoint(state.result, previous.px + (next.px - previous.px) * i / steps, previous.py + (next.py - previous.py) * i / steps);
      if (index !== null) changed = state.editor.paint(index) || changed;
    }
    state.lastCell = next;
    if (changed) refreshEdits();
    return;
  }
  // Fill cells between pointer events so a fast drag doesn't leave gaps.
  let { x, y } = state.lastCell || next;
  const dx = Math.abs(next.x - x), dy = -Math.abs(next.y - y);
  const sx = x < next.x ? 1 : -1, sy = y < next.y ? 1 : -1;
  let error = dx + dy, changed = false;
  while (true) {
    changed = state.editor.paint(y * state.result.columns + x) || changed;
    if (x === next.x && y === next.y) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  state.lastCell = next;
  if (changed) refreshEdits();
}

function mosaicPayload() {
  return { columns: state.result.columns, rows: state.result.rows, cells: state.result.cells,
    alphas: state.result.alphas,
    grid_shape: state.result.grid_shape, mirror: state.result.mirror,
    transparency: state.result.transparency,
    palette: state.result.palette, width_cm: Number($("widthCm").value), height_cm: Number($("heightCm").value), show_grid: $("gridLines").checked };
}

function preparePrint() {
  const documentSVG = new DOMParser().parseFromString(MosaicRasterizer.exportSVG(mosaicPayload()), "image/svg+xml");
  $("printArea").replaceChildren(document.importNode(documentSVG.documentElement, true));
}

function updateDimensions() {
  const width = Number($("widthCm").value), height = Number($("heightCm").value);
  const grid = Number($("gridSize").value);
  const hex = state.shape === "hexagon", circle = state.shape === "circle", layout = currentGridLayout();
  const count = layout.cell_count ?? layout.columns * layout.rows;
  $("gridLabel").textContent = circle ? `${grid} rings` : state.gridLinked ? hex ? `${grid} across` : `${grid} × ${grid}` : String(layout.columns);
  $("gridRowsValue").textContent = String(layout.rows);
  $("previewTag").textContent = circle ? `${count} dots` : hex ? `${layout.columns * layout.rows} hexagons` : `${layout.columns} × ${layout.rows} squares`;
  $("squareCount").textContent = count.toLocaleString();
  $("cellCountLabel").textContent = circle ? "dots" : hex ? "hexagons" : "squares";
  const valid = validDimensions();
  const dotRadius = circle ? MosaicRasterizer.cellCircle(layout, 0).rx : 0;
  $("canvasSize").textContent = valid ? `${width} × ${height} cm` : "Set print dimensions";
  $("physicalSize").textContent = valid ? `${width} × ${height}` : "—";
  $("cellSize").textContent = valid ? circle ? `Dots are ${(width * 20 * dotRadius).toFixed(2)} × ${(height * 20 * dotRadius).toFixed(2)} mm. ${grid} rings plus one center dot.` : hex ? `Hexagons are approximately ${(width * 10 / (layout.columns + .5)).toFixed(2)} × ${(height * 10 / ((layout.rows - 1) * .75 + 1)).toFixed(2)} mm. Only full tiles are shown.` : `Each tile is ${(width * 10 / layout.columns).toFixed(2)} × ${(height * 10 / layout.rows).toFixed(2)} mm` : "Enter dimensions from 1 to 50 cm.";
  updateActionButtons();
  drawPreview();
}

function drawPreview() {
  const workspace = $("canvasWorkspace");
  const ratio = state.view === "original" || !validDimensions() ? 1 : Number($("widthCm").value) / Number($("heightCm").value);
  const pad = window.innerWidth <= 650 ? 50 : window.innerWidth <= 850 ? 40 : 80;
  const availableWidth = Math.max(1, workspace.clientWidth - pad);
  const availableHeight = Math.max(1, workspace.clientHeight - (window.innerWidth <= 650 ? 76 : 81));
  const width = Math.min(availableWidth, availableHeight * ratio);
  const height = width / ratio;
  $("artFrame").style.width = `${width}px`;
  $("artFrame").style.height = `${height}px`;
  const original = state.view === "original";
  $("previewCanvas").hidden = original;
  $("originalImage").hidden = !original;
  workspace.classList.toggle("original-mode", original);
  workspace.classList.toggle("hexagon-mode", !original && state.shape === "hexagon");
  workspace.classList.toggle("transparency-mode", original || state.result?.alphas?.some(alpha => alpha < 255) ||
    state.shape === "circle" && state.result?.transparency !== false);
  if (!state.result || state.mosaicDirty || original) return;
  const canvas = $("previewCanvas");
  const scale = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  MosaicRasterizer.paintMosaic(canvas, { ...state.result, show_grid: $("gridLines").checked });
  const layoutLabel = state.result.grid_shape === "circle" ? `${state.result.cells.length} circular dots` : `${state.result.columns} by ${state.result.rows} ${state.result.grid_shape}`;
  canvas.setAttribute("aria-label", `${layoutLabel} mosaic using ${state.result.used_colors} colors`);
}

function renderSource(result) {
  state.preview = result;
  $("sourceThumbnail").src = result.image_preview;
  $("originalImage").src = result.image_preview;
  $("originalImage").alt = result.crop ? "Adjusted cropped source image" : "Adjusted original image";
  $("sourceName").textContent = state.sourceName;
  $("sourceName").title = state.sourceName;
  $("sourceMeta").textContent = `${result.source_size[0]} × ${result.source_size[1]} px${state.sourceStyle ? ` · ${state.sourceStyle}` : state.isDemo ? " · demo image" : ""}`;
  $("cropStatus").textContent = result.crop ? `Cropped · ${result.crop_size[0]} × ${result.crop_size[1]} px` : "Full image";
}

function renderResult(result) {
  renderSource(result);
  if (result.preview_only) {
    $("usedColors").textContent = "Select Mosaic to update colors";
    $("paletteTitle").textContent = "Your colors";
    $("colorCount").textContent = "—";
    updateDimensions();
    setView(state.view);
    return;
  }
  const previousPalette = state.result?.palette;
  if (!previousPalette || previousPalette.length !== result.palette.length || previousPalette.some((color, i) => color !== result.palette[i])) state.selectedColor = 0;
  state.result = result;
  state.mosaicDirty = false;
  state.editor = new MosaicEditor(result.cells, result.palette.length, 200, result.alphas);
  $("colorCount").textContent = String(result.palette.length);
  $("paletteTitle").textContent = `Your ${result.palette.length} color${result.palette.length === 1 ? "" : "s"}`;
  $("usedColors").textContent = `${result.used_colors} of ${result.palette.length} colors used`;
  renderSwatches();
  updatePaletteUsage();
  updateDimensions();
  setView(state.view);
}

function renderSwatches() {
  const result = state.result;
  $("swatches").replaceChildren();
  $("swatches").style.setProperty("--palette-columns", Math.min(10, result.palette.length));
  result.palette.forEach((color, i) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.classList.toggle("unused", result.counts[i] === 0);
    swatch.style.backgroundColor = color;
    swatch.tabIndex = 0;
    const label = `${result.palette_names[i] || `Color ${i + 1}`} · ${color} · ${result.counts[i]} ${tileName(result, result.counts[i])}`;
    swatch.title = label;
    swatch.setAttribute("aria-label", label);
    swatch.addEventListener("click", () => selectColor(i));
    $("swatches").append(swatch);
  });
}

async function convert(candidate = null, crop = undefined) {
  if (candidate) { candidate.id = ++state.sourceSequence; state.pendingSource = candidate; state.pendingCrop = null; }
  if (crop !== undefined) state.pendingCrop = crop;
  const selected = state.pendingSource;
  const source = selected?.blob || state.source;
  if (!source) { setBusy(false); return; }
  clearTimeout(state.timer);
  const revision = ++state.revision;
  state.controller?.abort();
  state.controller = new AbortController();
  setBusy(true);
  const options = { grid: $("gridSize").value, gridRows: state.gridLinked ? null : $("gridRows").value, shape: state.shape, palette: state.palette, fit: "contain",
    colors: $("colorLimit").value, mirror: $("mirrorHorizontal").checked, transparency: $("preserveTransparency").checked, previewOnly: state.view === "original" };
  for (const name of adjustmentNames) options[name] = $(name).value;
  const requestedCrop = state.pendingCrop !== undefined ? state.pendingCrop : state.crop;
  options.crop = requestedCrop;
  try {
    const result = await rasterizer.convert(source, selected?.id ?? state.sourceId, options, state.controller.signal);
    if (revision !== state.revision) return;
    state.crop = result.crop;
    state.pendingCrop = undefined;
    if (selected) {
      state.source = selected.blob;
      state.sourceId = selected.id;
      state.sourceName = selected.name;
      state.isDemo = selected.demo;
      state.sourceStyle = selected.style || "";
      state.selectedGalleryId = selected.galleryId;
      if (!state.gallery.some(entry => entry.galleryId === selected.galleryId)) {
        addGalleryImage({ ...selected, thumbnail: result.source_preview });
      }
      syncGallerySelection();
      state.pendingSource = null;
    }
    if (result.preview_only) state.mosaicDirty = true;
    renderResult(result);
  } catch (error) {
    if (error.name !== "AbortError" && revision === state.revision) {
      state.pendingSource = null;
      state.pendingCrop = undefined;
      notify(error.message, true);
      if (state.preview) {
        state.mosaicDirty = state.preview !== state.result;
        $("gridSize").value = state.preview.grid_size;
        state.shape = state.preview.grid_shape;
        state.gridLinked = state.preview.grid_rows == null;
        syncGridControls();
        $("gridRows").value = state.preview.rows;
        syncGridButtons();
        state.palette = state.preview.palette_mode;
        $("colorLimit").max = MosaicRasterizer.PRESETS[state.palette].max;
        $("colorLimit").value = state.preview.color_count;
        $("mirrorHorizontal").checked = state.preview.mirror;
        $("preserveTransparency").checked = state.preview.transparency;
        for (const name of adjustmentNames) $(name).value = state.preview.adjustments[name];
        updateAdjustments();
        syncPaletteButtons();
        syncLinkedPrintDimensions();
        updateDimensions();
      }
    }
  } finally {
    if (revision === state.revision) setBusy(false);
  }
}

function scheduleConversion() {
  state.mosaicDirty = true;
  clearTimeout(state.timer);
  state.revision++;
  state.controller?.abort();
  updateDimensions();
  setBusy(true);
  state.timer = setTimeout(() => convert(), 140);
}

function syncGridButtons() {
  for (const [id, shape] of gridButtons) {
    $(id).classList.toggle("active", state.shape === shape);
    $(id).setAttribute("aria-pressed", String(state.shape === shape));
  }
}

function currentGridLayout() {
  return MosaicRasterizer.gridLayout(Number($("gridSize").value), state.shape, state.gridLinked ? null : Number($("gridRows").value));
}

function syncLinkedPrintDimensions(anchor = "width") {
  if (!state.linked || !validDimensions()) return;
  const size = MosaicRasterizer.linkedPrintDimensions(
    { ...currentGridLayout(), grid_shape: state.shape }, $("widthCm").value, $("heightCm").value, anchor);
  $("widthCm").value = size.width;
  $("heightCm").value = size.height;
}

function syncGridControls() {
  const circle = state.shape === "circle";
  $("gridSize").min = circle ? 1 : 5;
  $("gridSize").max = circle ? 32 : 64;
  $("lockGridSize").disabled = circle;
  $("lockGridSize").setAttribute("aria-pressed", String(state.gridLinked));
  $("lockGridSize").textContent = state.gridLinked ? "↔ Linked" : "↔ Unlinked";
  $("gridSizeLabel").textContent = circle ? "Rings" : state.gridLinked ? "Size" : "Columns";
  $("gridRowsControl").hidden = state.gridLinked;
  $("gridRows").disabled = state.gridLinked;
  $("gridRows").max = state.shape === "hexagon" ? 74 : 64;
  if (state.gridLinked) $("gridRows").value = currentGridLayout().rows;
}

function syncPaletteButtons() {
  for (const [id, mode] of paletteButtons) {
    const active = mode === state.palette;
    $(id).classList.toggle("active", active);
    $(id).setAttribute("aria-pressed", String(active));
  }
  updateColorLimit();
}

function updateColorLimit() {
  const max = MosaicRasterizer.PRESETS[state.palette].max;
  $("colorLimit").max = max;
  $("colorLimit").value = Math.min(max, Number($("colorLimit").value));
  $("colorLimitValue").textContent = $("colorLimit").value;
  $("colorLimitMax").textContent = `${max} max`;
}

function choosePalette(mode) {
  if (state.palette === mode) return;
  state.palette = mode;
  syncPaletteButtons();
  scheduleConversion();
}

async function loadFile(file) {
  if (!file) return;
  if (!file.size || file.size > 15 * 1024 * 1024) { notify("Choose an image smaller than 15 MB.", true); return; }
  await convert({ blob: file, name: file.name, demo: false, galleryId: `upload-${++state.gallerySequence}` });
}

function makeSample() {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 640;
  const ctx = canvas.getContext("2d");
  ctx.scale(canvas.width / 800, canvas.height / 800);
  const sky = ctx.createLinearGradient(0, 0, 0, 800);
  sky.addColorStop(0, "#E8BF8B"); sky.addColorStop(.55, "#D38D58"); sky.addColorStop(1, "#EB653D");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 800, 800);
  ctx.fillStyle = "#F1E9CE"; ctx.beginPath(); ctx.arc(480, 273, 114, 0, Math.PI * 2); ctx.fill();
  function shape(color, points) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(...points[0]);
    points.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath(); ctx.fill();
  }
  shape("#8EB0AD", [[0,420],[100,340],[190,380],[300,300],[420,390],[500,365],[610,420],[720,355],[800,375],[800,800],[0,800]]);
  shape("#557B8E", [[0,465],[95,445],[200,485],[325,420],[410,445],[510,505],[610,445],[730,435],[800,470],[800,800],[0,800]]);
  shape("#334C6B", [[0,550],[90,470],[175,440],[230,460],[330,570],[415,580],[460,540],[535,530],[645,600],[730,590],[800,620],[800,800],[0,800]]);
  shape("#D38D58", [[0,660],[95,625],[190,595],[280,610],[360,650],[470,685],[620,700],[720,685],[800,645],[800,800],[0,800]]);
  shape("#EB653D", [[0,717],[80,673],[170,654],[250,663],[330,690],[435,735],[550,750],[665,726],[800,698],[800,800],[0,800]]);
  shape("#17253B", [[0,800],[0,755],[85,730],[165,750],[250,799],[580,800],[705,773],[800,782],[800,800]]);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function loadSample() {
  const sample = state.gallery.find(entry => entry.galleryId === "default-0");
  if (sample) await selectGalleryImage(sample, true);
}

function syncGallerySelection() {
  for (const button of $("imageGallery").children) {
    const selected = button.dataset.galleryId === state.selectedGalleryId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function addGalleryImage(entry) {
  state.gallery.push(entry);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery-image";
  button.dataset.galleryId = entry.galleryId;
  button.title = entry.style ? `${entry.name} · ${entry.style}` : entry.name;
  button.setAttribute("aria-label", `Select ${entry.name}`);
  button.setAttribute("aria-pressed", "false");
  const image = document.createElement("img");
  image.src = entry.thumbnail;
  image.alt = "";
  button.append(image);
  button.addEventListener("click", () => selectGalleryImage(entry));
  $("imageGallery").append(button);
}

async function selectGalleryImage(entry, force = false) {
  if (!force && entry.galleryId === state.selectedGalleryId && !state.busy) return;
  await convert({ blob: entry.blob, name: entry.name, style: entry.style, demo: entry.demo, galleryId: entry.galleryId });
}

async function initializeGallery() {
  try {
    const [sunset, extras] = await Promise.all([makeSample(), loadDefaultSamples()]);
    const images = [{ blob: sunset, name: "Sunset study", style: "Flat illustration" }, ...extras];
    images.forEach((image, i) => addGalleryImage({ ...image, demo: true,
      galleryId: `default-${i}`, thumbnail: URL.createObjectURL(image.blob) }));
    // An upload made during startup takes precedence over the sample.
    if (!state.source && !state.pendingSource) await loadSample();
  } catch (error) { notify(`Could not load the sample gallery: ${error.message}`, true); }
}

function setView(view) {
  finishStroke();
  const changed = state.view !== view;
  state.view = view;
  for (const [id, active] of [["mosaicView", view === "mosaic"], ["originalView", view === "original"]]) {
    $(id).classList.toggle("active", active); $(id).setAttribute("aria-pressed", String(active));
  }
  $("zoomCaption").textContent = view === "original" ? `ADJUSTED ${state.crop ? "CROPPED" : "ORIGINAL"} IMAGE · SCALED TO FIT` : "PRINT SIZE · PREVIEW SCALED TO FIT";
  drawPreview();
  updateEditingControls();
  if ((changed || view === "mosaic" && state.mosaicDirty) && (state.source || state.pendingSource) &&
      (state.busy || view === "mosaic" && state.mosaicDirty)) convert();
}

function renderCrop(editingField = null) {
  if (!state.cropDraft || !state.preview) return;
  const [width, height] = state.preview.source_size, rect = state.cropDraft;
  const selection = $("cropSelection");
  selection.style.left = `${rect.x / width * 100}%`;
  selection.style.top = `${rect.y / height * 100}%`;
  selection.style.width = `${rect.width / width * 100}%`;
  selection.style.height = `${rect.height / height * 100}%`;
  const squareMaximum = Math.min(width - rect.x, height - rect.y);
  for (const [id, value, maximum] of [["cropX", rect.x, width - rect.width], ["cropY", rect.y, height - rect.height],
    ["cropWidth", rect.width, $("squareCrop").checked ? squareMaximum : width - rect.x],
    ["cropHeight", rect.height, $("squareCrop").checked ? squareMaximum : height - rect.y]]) {
    if (id !== editingField) $(id).value = Math.round(value);
    $(id).max = Math.round(maximum);
  }
  $("applyCrop").disabled = false;
  selection.setAttribute("aria-label", `Crop selection: left ${Math.round(rect.x)}, top ${Math.round(rect.y)}, ${Math.round(rect.width)} by ${Math.round(rect.height)} pixels. Arrow keys move; Shift moves faster.`);
}

function sizeCropStage() {
  if (!$("cropDialog").open || !state.preview) return;
  const [width, height] = state.preview.source_size;
  const dialog = $("cropDialog"), style = getComputedStyle(dialog);
  const available = dialog.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  $("cropStage").style.width = `${Math.min(available, window.innerHeight * .46 * width / height)}px`;
}

async function openCrop() {
  if (state.busy || !state.preview) return;
  finishStroke();
  const result = state.preview;
  const image = $("cropImage"); image.src = result.source_preview;
  try { await image.decode(); } catch { notify("Could not open the crop preview.", true); return; }
  if (state.busy || state.preview !== result) return;
  const [width, height] = result.source_size;
  state.cropDraft = state.crop ? CropTools.fromNormalized(state.crop, width, height) : CropTools.centered(width, height);
  $("squareCrop").checked = Math.abs(state.cropDraft.width - state.cropDraft.height) < .01;
  $("cropDialog").showModal(); sizeCropStage(); renderCrop();
}

function cropPoint(event) {
  const bounds = $("cropStage").getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * state.preview.source_size[0],
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) * state.preview.source_size[1] };
}

function finishCropGesture(cancel = false) {
  const gesture = state.cropGesture;
  if (!gesture) return;
  const distance = Math.hypot(gesture.last.x - gesture.start.x, gesture.last.y - gesture.start.y) *
    $("cropStage").clientWidth / state.preview.source_size[0];
  if (cancel || gesture.kind === "draw" && distance < 4) state.cropDraft = gesture.before;
  state.cropGesture = null;
  if ($("cropStage").hasPointerCapture(gesture.pointer)) $("cropStage").releasePointerCapture(gesture.pointer);
  renderCrop();
}

$("cropButton").addEventListener("click", openCrop);
$("resetCropButton").addEventListener("click", () => { if (!state.busy) { state.mosaicDirty = true; convert(null, null); } });
for (const id of ["closeCrop", "cancelCrop"]) $(id).addEventListener("click", () => $("cropDialog").close());
$("cropDialog").addEventListener("close", () => finishCropGesture(true));
$("cropDialog").addEventListener("cancel", () => finishCropGesture(true));
window.addEventListener("resize", sizeCropStage);
window.addEventListener("blur", () => finishCropGesture(true));
$("squareCrop").addEventListener("change", () => {
  finishCropGesture();
  if ($("squareCrop").checked) state.cropDraft = CropTools.square(state.cropDraft);
  renderCrop();
});
$("fullCropSelection").addEventListener("click", () => {
  finishCropGesture(); $("squareCrop").checked = false;
  state.cropDraft = CropTools.centered(...state.preview.source_size, false); renderCrop();
});
$("cropStage").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || state.cropGesture) return;
  event.preventDefault();
  const handle = event.target.closest("[data-crop-handle]");
  const kind = handle ? "resize" : event.target.closest("#cropSelection") ? "move" : "draw";
  const point = cropPoint(event);
  state.cropGesture = { kind, handle: handle?.dataset.cropHandle, start: point, last: point,
    before: { ...state.cropDraft }, pointer: event.pointerId };
  (handle || $("cropSelection")).focus({ preventScroll: true });
  $("cropStage").setPointerCapture(event.pointerId);
});
$("cropStage").addEventListener("pointermove", (event) => {
  const gesture = state.cropGesture;
  if (!gesture || gesture.pointer !== event.pointerId) return;
  event.preventDefault();
  const point = cropPoint(event), [width, height] = state.preview.source_size;
  gesture.last = point;
  state.cropDraft = gesture.kind === "move" ? CropTools.move(gesture.before, point.x - gesture.start.x, point.y - gesture.start.y, width, height) :
    gesture.kind === "resize" ? CropTools.resize(gesture.before, gesture.handle, point, width, height, $("squareCrop").checked) :
      CropTools.draw(gesture.start, point, width, height, $("squareCrop").checked);
  renderCrop();
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  $("cropStage").addEventListener(name, (event) => {
    if (event.pointerId === state.cropGesture?.pointer) finishCropGesture(name !== "pointerup");
  });
}
$("cropSelection").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1, [width, height] = state.preview.source_size;
  const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
  const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
  const handle = event.target.dataset.cropHandle, rect = state.cropDraft;
  if (handle) {
    const point = { x: handle.includes("w") ? rect.x : rect.x + rect.width,
      y: handle.includes("n") ? rect.y : rect.y + rect.height };
    point.x += dx; point.y += dy;
    if ($("squareCrop").checked) {
      const growth = dx ? dx * (handle.includes("w") ? -1 : 1) : dy * (handle.includes("n") ? -1 : 1);
      point.x = (handle.includes("w") ? rect.x - growth : rect.x + rect.width + growth);
      point.y = (handle.includes("n") ? rect.y - growth : rect.y + rect.height + growth);
    }
    state.cropDraft = CropTools.resize(rect, handle, point, width, height, $("squareCrop").checked);
  } else state.cropDraft = CropTools.move(rect, dx, dy, width, height);
  renderCrop();
});
for (const id of ["cropX", "cropY", "cropWidth", "cropHeight"]) {
  $(id).addEventListener("input", () => {
    if ($(id).value && $(id).checkValidity()) updateNumericCrop(id, true);
    $("applyCrop").disabled = ["cropX", "cropY", "cropWidth", "cropHeight"].some((field) => !$(field).value || !$(field).checkValidity());
  });
  $(id).addEventListener("change", () => updateNumericCrop(id));
}
function updateNumericCrop(id, editing = false) {
  const value = Number($(id).value);
  if (!$(id).value || !Number.isFinite(value)) { renderCrop(); return; }
  const [width, height] = state.preview.source_size, rect = { ...state.cropDraft };
  if (id === "cropX" || id === "cropY") {
    state.cropDraft = CropTools.move(rect, id === "cropX" ? value - rect.x : 0, id === "cropY" ? value - rect.y : 0, width, height);
  } else {
    const side = Math.max(1, Math.round(value));
    if ($("squareCrop").checked) rect.width = rect.height = Math.min(side, width - rect.x, height - rect.y);
    else if (id === "cropWidth") rect.width = Math.min(side, width - rect.x);
    else rect.height = Math.min(side, height - rect.y);
    state.cropDraft = rect;
  }
  renderCrop(editing ? id : null);
}
$("applyCrop").addEventListener("click", () => {
  finishCropGesture();
  const [width, height] = state.preview.source_size;
  const rect = { x: Math.round(state.cropDraft.x), y: Math.round(state.cropDraft.y),
    width: Math.round(state.cropDraft.width), height: Math.round(state.cropDraft.height) };
  rect.width = Math.min(rect.width, width - rect.x);
  rect.height = Math.min(rect.height, height - rect.y);
  const normalized = CropTools.normalized(rect, width, height);
  const full = normalized.every((value, i) => Math.abs(value - [0, 0, 1, 1][i]) < 1e-10);
  $("cropDialog").close();
  state.mosaicDirty = true;
  convert(null, full ? null : normalized);
});

$("previewCanvas").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || state.pointerId !== null || state.busy || state.mosaicDirty || !state.editor || state.view !== "mosaic") return;
  const cell = cellAtPointer(event);
  if (!cell) return;
  event.preventDefault();
  $("previewCanvas").focus({ preventScroll: true });
  if (state.tool === "picker") { selectColor(state.result.alphas?.[cell.index] === 0 ? -1 : state.result.cells[cell.index]); return; }
  if (state.tool === "fill") {
    if (state.editor.fill(cell.index, state.selectedColor, state.result, MosaicRasterizer.cellNeighbors)) refreshEdits();
    return;
  }
  state.editor.beginStroke(state.selectedColor);
  state.pointerId = event.pointerId;
  $("previewCanvas").setPointerCapture(event.pointerId);
  paintToPointer(event);
});
$("previewCanvas").addEventListener("pointermove", (event) => {
  if (event.pointerId === state.pointerId) { event.preventDefault(); paintToPointer(event); }
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  $("previewCanvas").addEventListener(name, (event) => { if (event.pointerId === state.pointerId) finishStroke(); });
}
window.addEventListener("blur", finishStroke);
$("undoButton").addEventListener("click", () => historyAction("undo"));
$("redoButton").addEventListener("click", () => historyAction("redo"));
for (const [id, tool] of toolButtons) $(id).addEventListener("click", () => selectTool(tool));
$("customColor").addEventListener("input", () => {
  $("customColorHex").value = $("customColor").value.toUpperCase();
  updateEditingControls();
});
$("customColorHex").addEventListener("input", () => {
  const field = $("customColorHex");
  if (field.value && field.checkValidity()) $("customColor").value = "#" + field.value.replace(/^#/, "");
  updateEditingControls();
});
$("customColorHex").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); useCustomColor(); }
});
$("useCustomColor").addEventListener("click", useCustomColor);
$("transparentColor").addEventListener("click", () => selectColor(-1));
window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target.closest("input, select, textarea, [contenteditable], dialog")) return;
  const key = event.key.toLowerCase();
  if (key === "z" || key === "y") {
    event.preventDefault();
    historyAction(key === "y" || event.shiftKey ? "redo" : "undo");
  }
});

$("fileInput").addEventListener("change", (event) => { loadFile(event.target.files[0]); event.target.value = ""; });
$("dropzone").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("fileInput").click(); } });
for (const name of ["dragenter", "dragover"]) $("dropzone").addEventListener(name, (event) => { event.preventDefault(); $("dropzone").classList.add("dragover"); });
for (const name of ["dragleave", "drop"]) $("dropzone").addEventListener(name, (event) => { event.preventDefault(); $("dropzone").classList.remove("dragover"); });
$("dropzone").addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());
$("gridSize").addEventListener("input", () => {
  syncGridControls();
  syncLinkedPrintDimensions("height");
  scheduleConversion();
});
$("gridRows").addEventListener("input", () => {
  syncLinkedPrintDimensions("width");
  scheduleConversion();
});
$("lockGridSize").addEventListener("click", () => {
  if (state.shape === "circle") return;
  finishStroke();
  const previous = currentGridLayout();
  state.gridLinked = !state.gridLinked;
  if (!state.gridLinked) $("gridRows").value = previous.rows;
  syncGridControls();
  const next = currentGridLayout();
  if (previous.rows !== next.rows) syncLinkedPrintDimensions();
  if (state.busy || state.mosaicDirty || previous.rows !== next.rows) scheduleConversion();
  else {
    for (const result of [state.result, state.preview]) if (result) result.grid_rows = state.gridLinked ? null : next.rows;
    updateDimensions();
  }
});
for (const [id, shape] of gridButtons) $(id).addEventListener("click", () => {
  if (state.shape === shape) return;
  finishStroke();
  if (shape === "circle") {
    state.beforeCircle = { size: $("gridSize").value, rows: $("gridRows").value, linked: state.gridLinked,
      width: $("widthCm").value, height: $("heightCm").value };
    state.shape = shape; state.gridLinked = true;
    $("gridSize").value = 8;
    syncGridControls();
    $("widthCm").value = 7.5; $("heightCm").value = 7.5;
  } else {
    const previous = state.shape === "circle" ? state.beforeCircle : null;
    state.shape = shape;
    if (previous) {
      state.gridLinked = previous.linked;
      syncGridControls();
      $("gridSize").value = previous.size; $("gridRows").value = previous.rows;
      $("widthCm").value = previous.width; $("heightCm").value = previous.height;
    }
  }
  syncGridButtons(); syncGridControls();
  syncLinkedPrintDimensions();
  scheduleConversion();
});
for (const name of adjustmentNames) {
  const slider = $(name), field = $(name + "Value");
  slider.addEventListener("input", () => {
    updateAdjustments();
    scheduleConversion();
  });
  field.addEventListener("input", () => {
    // Leave intermediate text (a minus sign, blank, or out-of-range value)
    // alone while typing. Only valid whole numbers update the image live.
    if (!field.value || !field.validity.valid) return;
    if (Number(field.value) === Number(slider.value)) return;
    slider.value = field.value;
    updateAdjustments(name);
    scheduleConversion();
  });
  function commitValue() {
    const parsed = field.value === "" ? NaN : Number(field.value);
    const value = Number.isFinite(parsed) ? Math.max(-100, Math.min(100, Math.round(parsed))) : Number(slider.value);
    const changed = value !== Number(slider.value);
    slider.value = String(value);
    updateAdjustments();
    if (changed) scheduleConversion();
  }
  field.addEventListener("change", commitValue);
  field.addEventListener("blur", commitValue);
  field.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); commitValue(); }
  });
}
$("resetAdjustments").addEventListener("click", () => {
  for (const name of adjustmentNames) $(name).value = 0;
  updateAdjustments();
  scheduleConversion();
});
$("mirrorHorizontal").addEventListener("change", () => {
  if (state.busy || state.mosaicDirty || !state.editor) { scheduleConversion(); return; }
  finishStroke();
  state.editor.mirrorHorizontal(state.result.columns, state.result.grid_shape === "circle" ? i => MosaicRasterizer.cellMirrorIndex(state.result, i) : null);
  state.result.mirror = $("mirrorHorizontal").checked;
  state.preview.mirror = state.result.mirror;
  drawPreview();
  updateEditingControls();
});
for (const [id, mode] of paletteButtons) $(id).addEventListener("click", () => choosePalette(mode));
$("colorLimit").addEventListener("input", () => { updateColorLimit(); scheduleConversion(); });
$("gridLines").addEventListener("change", drawPreview);
$("preserveTransparency").addEventListener("change", scheduleConversion);
$("mosaicView").addEventListener("click", () => setView("mosaic"));
$("originalView").addEventListener("click", () => setView("original"));
$("resetButton").addEventListener("click", loadSample);
$("lockSize").addEventListener("click", () => {
  state.linked = !state.linked;
  $("lockSize").setAttribute("aria-pressed", String(state.linked));
  $("lockSize").textContent = state.linked ? "↔ Linked" : "↔ Unlinked";
  syncLinkedPrintDimensions();
  updateDimensions();
});
for (const [id, anchor] of [["widthCm", "width"], ["heightCm", "height"]]) {
  $(id).addEventListener("input", () => { syncLinkedPrintDimensions(anchor); updateDimensions(); });
  $(id).addEventListener("change", () => { if (!validDimensions()) $(id).reportValidity(); });
}
$("exportButton").addEventListener("click", () => {
  if (!state.result || !validDimensions() || state.busy || state.mosaicDirty) return;
  $("exportSummary").textContent = `${state.result.grid_shape === "circle" ? `${state.result.cells.length} dots` : state.result.grid_shape === "hexagon" ? `${state.result.cells.length} hexagons` : `${state.result.columns} × ${state.result.rows} squares`} · ${$("widthCm").value} × ${$("heightCm").value} cm · ${state.result.palette.length}-color palette`;
  $("exportDialog").showModal();
});
$("closeExport").addEventListener("click", () => $("exportDialog").close());
$("helpButton").addEventListener("click", () => $("helpDialog").showModal());
$("closeHelp").addEventListener("click", () => $("helpDialog").close());
$("printButton").addEventListener("click", () => {
  if (state.printing || state.busy || state.mosaicDirty || !state.result || !validDimensions()) return;
  state.printing = true;
  updateActionButtons();
  try {
    preparePrint();
    window.print();
  } catch (error) { notify(error.message, true); }
  finally { state.printing = false; updateActionButtons(); }
});
// Also prepare the current mosaic when printing through the browser menu or Ctrl+P.
window.addEventListener("beforeprint", () => {
  if (!state.result || !validDimensions() || state.busy || state.mosaicDirty) { $("printArea").replaceChildren(); return; }
  preparePrint();
  $("printArea").setAttribute("aria-hidden", "false");
});
window.addEventListener("afterprint", () => $("printArea").setAttribute("aria-hidden", "true"));
$("exportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.exporting || state.busy || state.mosaicDirty || !state.result || !validDimensions()) return;
  state.exporting = true;
  const button = $("downloadButton");
  button.disabled = true; button.textContent = "Preparing your mosaic…";
  const format = new FormData(event.target).get("format");
  const payload = mosaicPayload();
  try {
    const blob = await exportBrowserMosaic(payload, format);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const layoutName = payload.grid_shape === "circle" ? `${payload.cells.length}-dots` : `${payload.columns}x${payload.rows}`;
    anchor.href = url; anchor.download = `mosaic-${layoutName}-${payload.width_cm}x${payload.height_cm}cm.${format}`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $("exportDialog").close();
    notify(format === "svg" ? `Your SVG is ready. Print at actual size for ${payload.width_cm} × ${payload.height_cm} cm.` :
      `Your PNG is ready. Set its print size to ${payload.width_cm} × ${payload.height_cm} cm when printing.`);
  } catch (error) { notify(error.message, true); }
  finally { state.exporting = false; button.disabled = false; button.textContent = "↓ Download mosaic"; }
});
new ResizeObserver(drawPreview).observe($("canvasWorkspace"));
initializeGallery();
