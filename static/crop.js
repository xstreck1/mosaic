"use strict";

const CropTools = (() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function centered(width, height, square = true) {
    const side = Math.min(width, height);
    return square ? { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side } :
      { x: 0, y: 0, width, height };
  }
  function move(rect, dx, dy, width, height) {
    return { ...rect, x: clamp(rect.x + dx, 0, width - rect.width), y: clamp(rect.y + dy, 0, height - rect.height) };
  }
  function draw(start, end, width, height, square) {
    const a = { x: clamp(start.x, 0, width), y: clamp(start.y, 0, height) };
    const b = { x: clamp(end.x, 0, width), y: clamp(end.y, 0, height) };
    let dx = b.x - a.x, dy = b.y - a.y;
    if (square) { const side = Math.min(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -1 : 1) * side; dy = (dy < 0 ? -1 : 1) * side; }
    const w = Math.max(1, Math.abs(dx)), h = Math.max(1, Math.abs(dy));
    return { x: clamp(Math.min(a.x, a.x + dx), 0, width - w), y: clamp(Math.min(a.y, a.y + dy), 0, height - h), width: w, height: h };
  }
  function resize(rect, handle, point, width, height, square) {
    const opposite = { x: handle.includes("w") ? rect.x + rect.width : rect.x,
      y: handle.includes("n") ? rect.y + rect.height : rect.y };
    return draw(opposite, point, width, height, square);
  }
  function square(rect) {
    const side = Math.min(rect.width, rect.height);
    return { x: rect.x + (rect.width - side) / 2, y: rect.y + (rect.height - side) / 2, width: side, height: side };
  }
  function normalized(rect, width, height) {
    return [rect.x / width, rect.y / height, (rect.x + rect.width) / width, (rect.y + rect.height) / height];
  }
  function fromNormalized(rect, width, height) {
    return { x: rect[0] * width, y: rect[1] * height, width: (rect[2] - rect[0]) * width, height: (rect[3] - rect[1]) * height };
  }
  return { centered, move, draw, resize, square, normalized, fromNormalized };
})();
if (typeof module !== "undefined" && module.exports) module.exports = { CropTools };
