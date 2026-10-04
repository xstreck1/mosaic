# Mosaic — Image mosaic studio

A browser-only JavaScript app that converts images into a grid of flat-color squares or hexagons. Python only serves the static files. The defaults are **21 × 21 squares**, **11 × 11 cm**, and **From image**, which extracts a 20-color palette.

## Run

Requires a modern browser with Web Workers, OffscreenCanvas, and createImageBitmap. No packages, Pillow, Node.js, build step, or external services are needed to run the app.

```powershell
python server.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Use `python server.py --port 8001` if another app already uses port 8000. The server binds to `127.0.0.1` by default.

The app also works with Python's unmodified basic HTTP server:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory static
```

Any static web host can serve the contents of `static/`. All image conversion and downloads happen locally in your browser; there are no upload or export API endpoints.

## GitHub Pages

Live site: [xstreck1.github.io/mosaic](https://xstreck1.github.io/mosaic/).

The `.github/workflows/pages.yml` workflow checks the app and deploys only `static/` whenever `main` is pushed. It can also be run manually from GitHub's Actions tab. In the repository's **Settings → Pages**, the publishing source must be **GitHub Actions**. No Python server or build step is needed on Pages. Relative asset paths support both localhost and the `/mosaic/` project URL.

Local screenshots/previews, backups, and Python caches are excluded by `.gitignore`. The gallery sample pictures in `static/samples/` are required website assets and remain tracked. Future updates can be published with `git add`, `git commit`, and `git push`.

During deployment, JavaScript, CSS, and gallery PNG URLs (including the worker and its imports) are versioned with the Git commit hash. Updates therefore load fresh assets instead of reusing a previous deployment from the browser or Pages cache. The generated `_site/` folder is also ignored by Git.

## Use

- Drop an image onto the upload area or browse for a file. Successfully decoded uploads are added to the six-column gallery below the upload area and selected automatically. Click any thumbnail to select it; clicking the current selection preserves edits. Switching images clears the crop and painted edits while retaining palette, adjustment, grid shape, grid size, and print settings. Uploaded gallery pictures stay available in the current tab until reload; export mosaics to save your work.
- Six built-in pictures have different styles and palettes: **Sunset study** (flat landscape illustration), **Bright cat** (vivid pop art), **Sci-fi robot** (a bright cyan-and-ivory cartoon with amber lights on dark navy), **Coastal boat** (natural photography in marine blue, wood brown, and ivory), **Earth** (a flat blue-and-green globe on white), and **Strawberry** (a red botanical illustration on white). Style names appear in thumbnail tooltips and source details. All six default source images are 640 × 640 pixels. The sunset is generated locally on canvas; five generated PNG assets used by the gallery are bundled in `static/samples/`, with the original prompts in `generation-prompts.md`. All samples work offline once served locally and stay available alongside uploads. The restore button selects the sunset again.
- Choose **Squares** or **Hexagons** in section 02, with grid sizes from 5 to 64. Squares use an N × N grid. Hexagons use staggered honeycomb rows and sample the actual area of each tile. All hexagons are complete, including at the edges; the surrounding transparent margins form a scalloped border and cannot be painted. The preview workspace shows through these gaps, and PNG and SVG exports preserve their transparency. The preview shows the actual tile count. The shape applies to painting, undo/redo, mirroring, grid lines, printing, SVG and PNG exports. Switching shape rebuilds the mosaic and clears painted edits.
- Images automatically fit inside the mosaic with white padding where needed. Use **Crop image** to choose which part of the source to include.
- Grid size defaults to **Linked**, with one slider: square rows follow columns, and hexagon rows follow the existing honeycomb proportions. Click the grid's **Linked** button to expose independent **Columns** and **Rows** sliders. Unlinking preserves the current layout and painted edits; linking again makes the rows follow columns. Columns range from 5 to 64; rows range from 5 to 64 for squares or 74 for hexagons. Grid linking is separate from print-dimension linking. Changing either axis rebuilds tiles; in Original view, tile calculation waits until Mosaic is selected.
- Toggle **Mirror horizontally** in section 02 to flip the mosaic left to right. Printing and exports use the mirrored layout. The original comparison and crop editor keep the source orientation. Mirroring persists through cropping and other settings, and preserves painted edits and undo/redo history. Undo and redo follow the painted tiles to their mirrored positions.
- Click **Crop image** under the source thumbnail to choose your own region. Drag inside the selection to move it, drag its corner handles to resize it, or drag outside it to draw a new selection. A square selection is the default; uncheck **Square selection** for a freeform rectangle. You can also enter left, top, width, and height in source pixels. Focus the selection or a handle and use arrow keys to move or resize it; Shift uses ten-pixel steps.
- **Apply crop** regenerates the mosaic from the selected original pixels. Freeform selections fit inside the mosaic with white padding so the entire crop stays visible. **Cancel** leaves your mosaic untouched; **Reset crop** removes the custom crop. Crops persist through grid shape, grid size, palette, and print-size changes. New uploads and restoring the demo clear the crop. The crop editor always shows the full original, and the **Original** comparison shows the current cropped source. Applying/resetting a crop clears painted edits and history. Crops are held in browser memory and are lost on reload.
- **From image**, selected by default, extracts colors using median-cut quantization. **Vibrant** is the former Reference 20 bead palette. **Pastel**, **Neon**, **Grayscale**, **Rainbow**, and **Commodore 64** are additional fixed palettes. Use the **Color limit** slider to request 2 colors through the selected palette's maximum; changing palettes clamps the current limit to that maximum. The number is an upper limit: simple images can use fewer colors, and duplicate adaptive colors are merged.
- Practical palette caps are **Vibrant 20**, **Pastel 24**, **Neon 16**, **Grayscale 16**, **Rainbow 24**, **Commodore 64 16**, and **From image 64**. The aesthetic palettes use chosen finite catalogs rather than universal color-space limits. Pastel has soft hues in three tones, Neon has saturated hues and contrasting neutrals, Grayscale uses evenly spaced perceptual lightness, and Rainbow has seven hue families at three brightness levels plus neutrals. Commodore 64 uses the 16-color [Colodore VIC-II model](https://www.pepto.de/projects/colorvic/). Grid size remains independent, from 5 to 64 across.
- In **Your colors**, choose a custom color using the color picker or a six-digit hex value, then click **Use color** (or press Enter in the hex field) to add and select a paint swatch. Existing colors are reused. Custom swatches preserve previous edits and undo/redo, and appear in print and exports; total palette size is capped at 64. Rebuilding the mosaic resets custom swatches along with painted edits.
- Fixed palette matching prioritizes hue: visibly colored tiles are restricted to nearby palette hues, then perceptual lightness and saturation select a shade. Near-neutral tiles use the available neutral swatches; Grayscale matches all samples by lightness. Reducing most fixed palettes selects a subset from that palette using weighted hue and tone coverage, then rematches the cells. A pure-white background is retained when present. Rainbow always reserves black and white, spreads reduced hue slots from red through purple, and retains all seven vivid hue families at a limit of 9 or more. Additional slots add shades chosen for the source image. It does not add interpolated colors. With a limited palette, preserving hue can make muted colors more vivid or change their brightness. Painting, counts, printing, SVG and PNG all use the resulting palette size.
- Use **Vibrance**, **Brightness**, and **Contrast** sliders or type directly into their number fields, from −100 to +100, to tune the mosaic. Fields and sliders stay synchronized. Valid whole numbers update the image as you type; Enter or leaving a field clamps values to the range, rounds decimals, and restores an empty field to its last applied value. Vibrance emphasizes muted colors more than already saturated colors. Zero is neutral; **Reset adjustments** restores all three to zero. Adjustments regenerate from the original pixels, apply to every palette, and persist through cropping and new uploads. Transparent areas and padding stay white. The **Original** view shows the same color adjustments as the mosaic, before palette matching. The crop editor keeps the unadjusted full source for selecting a region. Changes clear painted edits and undo/redo history.
- Set print width and height between 1 and 50 cm. They are linked by default for square output. Unlinking allows rectangular output and stretches the cells.
- In **Original**, changing colors, color limit, cropping, grid shape, grid size, or palette updates only the image preview; tile averaging and palette matching are deferred. Select **Mosaic** to calculate tiles using the latest settings. If the cached mosaic is still current, switching views preserves painted edits and avoids recalculation. After settings change in Original, the palette, painting, printing, and exports become available again once you select Mosaic. Optionally enable grid lines, then export.
- Select a palette color, then click or drag across the mosaic to paint its tiles. Each click or drag is one undo step. Use **Undo / Redo**, **Ctrl+Z**, **Ctrl+Shift+Z**, or **Ctrl+Y** (Cmd works on macOS). Up to 200 steps are retained; painting after undo clears the redo history. Color counts, exports, and printing all reflect the edited mosaic.
- Changing the source image, crop, grid shape, grid size, palette, or adjustments regenerates the mosaic and clears the edit history. Changing print dimensions, toggling grid lines, or comparing the original preserves edits. Edits are held in this browser session and are lost on reload; export your work to keep it.
- Click **Print** to open the browser's print dialog with just the mosaic, at your selected dimensions. Choose **100% / actual size**, disable browser headers and footers, and select paper large enough to fit the mosaic (with 10 mm page margins). Print uses vector tiles, so it stays sharp and includes your grid-line setting even when viewing the original image.

**SVG** preserves exact physical dimensions in centimeters and remains sharp at any scale. Print at **100% / actual size**, with page scaling disabled. **PNG** uses the same high-resolution pixel dimensions as before (1,299 × 1,299 at the default 11 × 11 cm), but carries no custom DPI or print-size metadata. Set the desired physical size when printing a PNG; use SVG or the app's **Print** button for exact dimensions. PNG square tiles use integer pixel boundaries; hexagonal tiles use smooth polygon edges.

PNG, JPEG, WebP, GIF, and BMP are supported, up to 15 MB and 25 megapixels. TIFF support has been removed. Browser decoding applies EXIF orientation and uses the first frame of GIFs. Transparency is flattened onto white before averaging or palette matching; partially transparent edges blend with white, and hidden colors in fully transparent pixels have no effect. Color adjustments apply to foreground colors before this white composite. The reference palette uses pure white (`#FFFFFF`) and pure black (`#000000`). Original and cropped comparison previews show the current color adjustments and are bounded to 1,000 pixels per side. The full source preview used in the crop editor stays unadjusted.

Image decoding, pixel averaging, hue matching, and adaptive median-cut palettes run in a Web Worker. Reference matching measures circular HSV hue differences; candidates within 12 degrees of the nearest palette hue are scored by hue, CIE Lab lightness, and HSV saturation. Samples with a channel range of at most 10 out of 255 or saturation below 8% use neutral swatches by lightness. Slider changes cancel stale conversions. Source pixels are cached in worker memory between conversions and are never uploaded, saved, or sent to a third party. PNG and SVG downloads are generated as local Blob URLs. Browser and Pillow rounding/quantization differ slightly, so some cells may change from the previous Python implementation.

The fixed palette follows the [supplied reference](static/palette-reference.png), left to right, top to bottom. Each color is the median RGB value from a 19-pixel-radius circle inside its swatch, excluding the white background. The lightest swatch and black swatch are normalized to pure white and black; the remaining colors approximate photographed beads rather than manufacturer color specifications. The final black-and-white mixed swatch is represented as flat dark gray. Color names and hex values appear in swatch tooltips.

## Check

Node.js is only needed to run the algorithm and editing tests, not to use the app.

```powershell
node --check static/app.js
node --check static/rasterizer.js
node --check static/raster-worker.js
node --test tests/rasterizer.test.js tests/raster-worker.test.js tests/browser-rasterizer.test.js tests/editor.test.js tests/crop.test.js
python -m unittest discover -s tests -v
```

## Structure

- `server.py`: Python standard-library static HTTP server. It contains no image processing or APIs.
- `static/rasterizer.js`: pure JavaScript pixel averaging, adjustments, crop geometry, reference and adaptive palettes, export validation, SVG generation, and PNG painting.
- `static/raster-worker.js`: browser image decoding, preview generation, and cached background conversion.
- `static/browser-rasterizer.js`: cancellable worker client and local download generation.
- `static/app.js`: upload controls, gallery selection, editing, mirroring, printing, and exports.
- `static/sample-images.js`: loads the five additional gallery assets from `static/samples/`.
- `static/editor.js` and `static/crop.js`: undo/redo history and crop interaction geometry.
- `tests/`: JavaScript algorithm/editing tests and Python static-server checks.

The previous Python implementation is preserved in `backups/2026-10-03-203242-before-browser-js-migration.zip`.
