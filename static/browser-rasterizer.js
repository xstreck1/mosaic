"use strict";

// Aborted work is terminated, so rapid slider changes never queue stale conversions.
class BrowserRasterizer {
  constructor() { this.worker = null; }

  convert(blob, sourceId, options, signal) {
    if (signal.aborted) return Promise.reject(new DOMException("Conversion canceled.", "AbortError"));
    if (!this.worker) this.worker = new Worker("./raster-worker.js");
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener("abort", abort); worker.onmessage = null; worker.onerror = null; };
      const abort = () => {
        cleanup(); worker.terminate();
        if (this.worker === worker) this.worker = null;
        reject(new DOMException("Conversion canceled.", "AbortError"));
      };
      worker.onmessage = ({ data }) => { cleanup(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
      worker.onerror = () => {
        cleanup(); worker.terminate(); this.worker = null;
        reject(new Error("Browser image processing failed. Try a smaller PNG or JPEG."));
      };
      signal.addEventListener("abort", abort, { once: true });
      worker.postMessage({ blob, sourceId, options });
    });
  }
}

async function exportBrowserMosaic(payload, format) {
  if (format === "svg") return new Blob([MosaicRasterizer.exportSVG(payload)], { type: "image/svg+xml" });
  if (format !== "png") throw new Error("Choose PNG or SVG for export.");
  const canvas = MosaicRasterizer.paintExport(document.createElement("canvas"), payload);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not export this image.")), "image/png"));
}
