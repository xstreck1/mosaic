"use strict";
importScripts("./rasterizer.js");

let cachedBlob = null, pixels = null, sourceCanvas = null, sourcePreview = null;
let adjustedPreview = null, adjustedKey = null;

async function preview(canvas, bounds) {
  const [left, top, right, bottom] = bounds, width = right - left, height = bottom - top;
  const scale = Math.min(1, 1000 / Math.max(width, height));
  const output = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  const ctx = output.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(canvas, left, top, width, height, 0, 0, output.width, output.height);
  return new FileReaderSync().readAsDataURL(await output.convertToBlob({ type: "image/png" }));
}

async function adjustedImagePreview(settings) {
  const key = JSON.stringify([settings.crop, settings.adjustments]);
  if (key === adjustedKey) return adjustedPreview;
  const bounds = MosaicRasterizer.cropBounds(pixels.width, pixels.height, settings.crop);
  let value;
  if (!Object.values(settings.adjustments).some(Boolean)) {
    value = settings.crop ? await preview(sourceCanvas, bounds) : sourcePreview;
  } else {
    const [left, top, right, bottom] = bounds, width = right - left, height = bottom - top;
    const cropped = sourceCanvas.getContext("2d").getImageData(left, top, width, height);
    MosaicRasterizer.adjustPixels(cropped.data, settings.adjustments, true);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").putImageData(cropped, 0, 0);
    value = await preview(canvas, [0, 0, width, height]);
  }
  adjustedKey = key; adjustedPreview = value;
  return value;
}

self.onmessage = async ({ data: { blob, sourceId, options } }) => {
  try {
    if (!blob?.size || blob.size > 15 * 1024 * 1024) throw new Error("Choose an image smaller than 15 MB.");
    if (/tiff/i.test(blob.type)) throw new Error("Use a PNG, JPEG, WebP, GIF, or BMP image.");
    if (cachedBlob !== sourceId) {
      let bitmap;
      try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image", premultiplyAlpha: "none" }); }
      catch { throw new Error("This image could not be read. Use a PNG, JPEG, WebP, GIF, or BMP image."); }
      try {
        if (bitmap.width * bitmap.height > 25000000) throw new Error("The image must be no larger than 25 megapixels.");
        sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        sourcePreview = await preview(sourceCanvas, [0, 0, bitmap.width, bitmap.height]);
        adjustedPreview = null; adjustedKey = null;
        cachedBlob = sourceId;
      } finally { bitmap.close(); }
    }
    const result = options.previewOnly ? MosaicRasterizer.imageSettings(pixels.width, pixels.height, options) :
      MosaicRasterizer.rasterizePixels(pixels.data, pixels.width, pixels.height, options);
    result.preview_only = Boolean(options.previewOnly);
    result.source_preview = sourcePreview;
    result.image_preview = await adjustedImagePreview(result);
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error.message || "Could not process this image." }); }
};
