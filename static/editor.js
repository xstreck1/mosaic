"use strict";

// Edits mutate the mosaic's cell array so preview, export, and print share one result.
class MosaicEditor {
  constructor(cells, paletteSize, historyLimit = 200) {
    this.cells = cells;
    this.paletteSize = paletteSize;
    this.historyLimit = historyLimit;
    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
  }

  beginStroke(color) {
    if (!Number.isInteger(color) || color < 0 || color >= this.paletteSize) throw new RangeError("Invalid palette color.");
    this.endStroke();
    this.stroke = { color, changes: new Map() };
  }

  paint(index) {
    if (!this.stroke || !Number.isInteger(index) || index < 0 || index >= this.cells.length) return false;
    if (this.cells[index] === this.stroke.color) return false;
    if (!this.stroke.changes.has(index)) this.stroke.changes.set(index, this.cells[index]);
    this.cells[index] = this.stroke.color;
    return true;
  }

  endStroke() {
    if (!this.stroke) return false;
    const { color, changes } = this.stroke;
    this.stroke = null;
    if (!changes.size) return false;
    this.undoStack.push([...changes].map(([index, before]) => ({ index, before, after: color })));
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  undo() {
    this.endStroke();
    const changes = this.undoStack.pop();
    if (!changes) return false;
    changes.forEach(({ index, before }) => { this.cells[index] = before; });
    this.redoStack.push(changes);
    return true;
  }

  redo() {
    this.endStroke();
    const changes = this.redoStack.pop();
    if (!changes) return false;
    changes.forEach(({ index, after }) => { this.cells[index] = after; });
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
