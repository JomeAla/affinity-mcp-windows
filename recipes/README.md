# SDK recipes

Paste-ready scripts and hard-won patterns for driving Affinity's JavaScript SDK
through `execute_script`. These grew out of a full production project (dark
Japanese streetwear graphics: samurai, hannya oni mask, coiled dragon) drawn
entirely with vector SDK calls — no AI image generation.

## Files

| File | What it is |
| --- | --- |
| `affinity-drawing-helpers.js` | Helper block to paste at the top of any drawing script (node builders, blob/splatter generator, mirror, ring-with-hole). |
| `build-hannya-oni.js` | Complete, parametric tee-print build (3600x4800 @300dpi, transparent). Flip `MODE` between `ink` (light garments) and `inverse` (black garments). |
| `export-outlined-vector.js` | Standalone print-safe vector export (outline text -> export SVG/PDF -> undo). Mirrors the `affinity.export_outlined` tool. |
| `ops-runtime.mjs` | Node-side harness: turn a JSON op list (poly / batch / text) into a runnable Affinity script via `buildScript(ops, opts)`. The producer half of large composite scenes — pair with `scripts/affinity-driver.mjs run`. |

Scripts cannot `require()` these files unless the folder is added under
Affinity's scripting filesystem permissions, so treat them as copy-paste
sources. SDK modules (`/document.js`, `/nodes.js`, ...) are always importable.
`ops-runtime.mjs` is the exception in spirit: it runs in *Node*, writes a
generated `.js`, and the driver executes that file inside Affinity.

## Patterns that took the longest to learn

1. **Keep saves in their own script call.** Calling `doc.save()`/`saveAs()` in
   the same `execute_script` run that deleted nodes can wedge the document
   (subsequent saves fail with `LOCK_LOST` / `CREATE_FILE_ERROR` while exports
   keep working). Recovery: `createAddDocumentSnapshot` via command, then
   `snapshot.createDocument()` -> `saveAs()` the copy and close the wedged one.

2. **Snapshot-created documents are unreliable for text.** After
   `snapshot.createDocument()`, text nodes can report stale `baseBox` values,
   `isArtTextNode` can misidentify non-text nodes, and transforms may apply but
   not show up in boxes. Build text in fresh documents, and when in doubt:
   measure in one call, build finals in the next call, position in a third.

3. **Text sizing recipe.** Create the text at `height = 100`, read
   `baseBox.width`, then `widthRatio = width / 100`; the final size is
   `H = targetWidth / widthRatio`. `baseBox` for art text is story-space
   (position around y = -100000) before placement; `applyTransform` then moves
   it to the story-space target. `characterSpacing` is in **points** (absolute,
   not em), so proportional tracking needs `spacingPts = 0.036 * H` for ~0.15em
   at 300dpi.

4. **`DocumentProperties.dimensions` scales existing content** per axis by
   `S = (newW/oldW, newH/oldH)`. To lay a design out on a different canvas:
   resize, add a full-size background rect (added last, then moved behind with
   `DocumentCommand.createMoveNodes(sel, target, NodeMoveType.Before, NodeChildType.Main)`),
   then apply a per-node correction so art lands scaled by `s` at offset `t`:
   `A = (s/Sx, s/Sy)`, `b = t * (1 - 1/S)`, transform `T = Translate(b) * Scale(A)`.

5. **Do not trust `render_spread` for layout QA.** It renders the current
   viewport (zoom/pan), not necessarily the whole spread, and stale transforms
   mislead. Ground truth: export a PNG (absolute Desktop path) and inspect the
   file.

6. **Donut/ring fills** need the inner curve wound the opposite way: transform
   the inner ellipse with `Translate(cx,cy) * Scale(-1,1) * Translate(-cx,-cy)`
   and add both curves to one `PolyCurve`.

7. **OneDrive-redirected Desktops.** Affinity reports its Desktop as
   `C:\Users\<you>\Desktop`, but when OneDrive redirects the Desktop, writes
   only succeed under `C:\Users\<you>\OneDrive\Desktop` — always pass absolute
   paths for exports.

8. **Vector export presets** must match Affinity exactly: `SVG (for export)`,
   `PDF (for print)`, `EPS (for export)`, `PNG`, `JPEG (Best quality)`,
   `TIFF RGB 8-bit`. Plain `SVG`/`PDF`/`JPEG`/`TIFF` names do not exist and fail
   with a bare error record. Outline text first (`doc.convertToCurves` per art
   text node) for a print-safe file, then undo the outlining afterwards —
   that is exactly what `affinity.export_outlined` does.

9. **Z-order.** `doc.addNode` appends on top. To send a node to the back,
   move it before the first sibling with the `createMoveNodes` command
   (`NodeMoveType.Before`).

10. **Ink energy is parametric.** Splatters: radial blob with harmonic radius
    variation plus one long tendril, smoothed through Catmull-Rom style
    control points. Halftone: an arc of circles at fixed radius from the
    design center with sizes falling off linearly. Both are a dozen lines of
    JS — see the helpers file.

11. **Batch same-colour shapes into ONE multi-curve node.** Per-node
    `addNode` costs roughly 4 nodes/sec in a large document — a 5,500-shape
    scene takes ~13 minutes. A `PolyCurve` holding hundreds of *disjoint*
    subpaths costs the same as one node, so group shapes by fill colour
    (quantise alpha to keep group counts sane) and add one node per group.
    The same scene drops to a few hundred ops and builds in seconds. Caveat:
    a PolyCurve fills with the even-odd rule — overlapping subpaths inside a
    single node cancel out, so keep batches to non-overlapping shapes and
    draw anything overlapping as its own node. See `ops-runtime.mjs` (`batch`
    op kind).

12. **Linear gradients run along the transform box DIAGONAL**, not the axis.
    A gradient fill's transform defines a box; stop 0..1 maps from
    `(x0, y0)` to `(x1, y1)` of that box — set `bbox` to the shape's extents
    for a corner-to-corner falloff. If you build art at local coordinates and
    later translate it (say, +1200 px for the right-hand panel of a diptych),
    you MUST shift the gradient metadata too (`bbox[0]`, `bbox[2]`, or a
    radial's `cx`). Shifting only the points leaves the gradient sampling the
    old transform box — silently, with no error.

13. **Spread navigation.** To jump to a specific page/spread in a
    multi-spread document: collect `doc.spreads` into an array and
    `doc.executeCommand(DocumentCommand.createSetCurrentSpread(spreads[i]))`.
    Useful before anything viewport-dependent.

14. **QA against the exported PNG, at 1:1.** An export of a
    `1200x600 @300dpi`-per-panel document at PNG preset comes out at exactly
    document pixel size (e.g. 2400x1200 for a 2400x1200 document), so crop
    coordinates from pixel inspection map 1:1 onto doc coordinates. Round-trip
    through `affinity.render_spread` renders the *viewport* and can mislead;
    the exported file is ground truth.
