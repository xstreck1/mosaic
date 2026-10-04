"use strict";

// Edits mutate the mosaic's cell array so preview, export, and print share one result.
class MosaicEditor {
  constructor(cells, paletteSize, historyLimit = 200, alphas = null) {
    this.cells = cells;
    this.alphas = alphas ?? new Array(cells.length).fill(255);
    if (!Array.isArray(this.alphas) || this.alphas.length !== cells.length || this.alphas.some(alpha => alpha !== 0 && alpha !== 255))
      throw new RangeError("Tile opacity must be solid or clear.");
    this.paletteSize = paletteSize;
    this.historyLimit = historyLimit;
    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
  }

  beginStroke(color) {
    if (!Number.isInteger(color) || color < -1 || color >= this.paletteSize) throw new RangeError("Invalid palette color.");
    this.endStroke();
    this.stroke = { color, changes: new Map() };
  }

  addColor(color, palette) {
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Enter a six-digit hex color.");
    const normalized = color.toUpperCase();
    const existing = palette.findIndex(entry => entry.toUpperCase() === normalized);
    if (existing >= 0) return existing;
    if (palette.length >= 64) throw new Error("This mosaic already has 64 colors. Choose an existing swatch or reduce the color limit first.");
    // Append rather than replace: existing cells and history keep their colors.
    palette.push(normalized);
    this.paletteSize = palette.length;
    return palette.length - 1;
  }

  paint(index) {
    if (!this.stroke || !Number.isInteger(index) || index < 0 || index >= this.cells.length) return false;
    const alpha = this.stroke.color === -1 ? 0 : 255;
    if (this.alphas[index] === alpha && (!alpha || this.cells[index] === this.stroke.color)) return false;
    if (!this.stroke.changes.has(index)) this.stroke.changes.set(index, { color: this.cells[index], alpha: this.alphas[index] });
    if (alpha) this.cells[index] = this.stroke.color;
    this.alphas[index] = alpha;
    return true;
  }

  fill(index, color, grid) {
    const { columns, rows, grid_shape = "square", mirror = false } = grid;
    if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1 ||
        columns * rows !== this.cells.length || !["square", "hexagon"].includes(grid_shape) ||
        typeof mirror !== "boolean") throw new RangeError("Invalid fill grid.");
    if (!Number.isInteger(index) || index < 0 || index >= this.cells.length) return false;
    this.beginStroke(color);
    const target = this.cells[index], targetAlpha = this.alphas[index], pending = [index], visited = new Uint8Array(this.cells.length);
    if (!targetAlpha && color === -1) return this.endStroke();
    visited[index] = 1;
    while (pending.length) {
      const current = pending.pop();
      if (targetAlpha ? !this.alphas[current] || this.cells[current] !== target : this.alphas[current] !== 0) continue;
      this.paint(current);
      const col = current % columns, row = Math.floor(current / columns);
      const neighbors = [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]];
      if (grid_shape === "hexagon") {
        // Reflect the staggered row offsets along with mirrored hexagon tiles.
        const shift = Boolean(row % 2) !== mirror ? 1 : -1;
        neighbors.push([col + shift, row - 1], [col + shift, row + 1]);
      }
      for (const [x, y] of neighbors) {
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
        const next = y * columns + x;
        if (!visited[next]) { visited[next] = 1; pending.push(next); }
      }
    }
    return this.endStroke();
  }

  endStroke() {
    if (!this.stroke) return false;
    const { changes } = this.stroke;
    this.stroke = null;
    if (!changes.size) return false;
    this.undoStack.push([...changes].map(([index, before]) => ({ index, before: before.color, beforeAlpha: before.alpha,
      after: this.cells[index], afterAlpha: this.alphas[index] })));
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  undo() {
    this.endStroke();
    const changes = this.undoStack.pop();
    if (!changes) return false;
    changes.forEach(({ index, before, beforeAlpha }) => { this.cells[index] = before; this.alphas[index] = beforeAlpha; });
    this.redoStack.push(changes);
    return true;
  }

  redo() {
    this.endStroke();
    const changes = this.redoStack.pop();
    if (!changes) return false;
    changes.forEach(({ index, after, afterAlpha }) => { this.cells[index] = after; this.alphas[index] = afterAlpha; });
    this.undoStack.push(changes);
    return true;
  }

  mirrorHorizontal(columns) {
    if (!Number.isInteger(columns) || columns < 1 || this.cells.length % columns !== 0) throw new RangeError("Invalid grid width.");
    this.endStroke();
    for (let start = 0; start < this.cells.length; start += columns) {
      for (let x = 0; x < Math.floor(columns / 2); x++) {
        const left = start + x, right = start + columns - 1 - x;
        [this.cells[left], this.cells[right]] = [this.cells[right], this.cells[left]];
        [this.alphas[left], this.alphas[right]] = [this.alphas[right], this.alphas[left]];
      }
    }
    // Move undo/redo coordinates with their painted squares.
    for (const stack of [this.undoStack, this.redoStack]) {
      for (const changes of stack) {
        for (const change of changes) change.index = Math.floor(change.index / columns) * columns + columns - 1 - change.index % columns;
      }
    }
  }

  get canUndo() { return this.undoStack.length > 0 || Boolean(this.stroke?.changes.size); }
  get canRedo() { return this.redoStack.length > 0 && !this.stroke?.changes.size; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { MosaicEditor };
