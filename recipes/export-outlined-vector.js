'use strict';
// export-outlined-vector.js
// Print-safe vector export of the CURRENT document:
//   1. outline every artistic-text node (convert to curves),
//   2. export with the correct Affinity preset,
//   3. undo the outlining so the open document keeps live text.
//
// Set TARGET and FORMAT below, then run via affinity.execute_script.
// (The affinity.export_outlined tool wraps this same logic.)

const TARGET = 'C:/Users/you/OneDrive/Desktop/export_outlined.svg';
const FORMAT = 'svg'; // 'svg' | 'pdf' | 'eps'

const PRESETS = {
  svg: 'SVG (for export)',
  pdf: 'PDF (for print)',
  eps: 'EPS (for export)',
};

(function () {
  const { Document, FileExportOptions, FileExportArea } = require('/document.js');
  try {
    const doc = Document.current;
    if (!doc) {
      console.log(JSON.stringify({ exported: false, error: 'no open document' }));
      return;
    }
    const nodes = [];
    for (const n of doc.layers) nodes.push(n);
    const texts = nodes.filter(function (n) { return n.isArtTextNode; });
    for (const t of texts) doc.convertToCurves(t.selfSelection);

    let exported = false;
    const results = [];
    try {
      const opts = FileExportOptions.createWithPresetName(PRESETS[FORMAT]);
      const records = doc.export(TARGET, opts, FileExportArea.createForWholeDocument(), null);
      for (const r of records.all) {
        results.push({ path: r.path, ok: r.isSuccess, error: r.isSuccess ? undefined : r.errorMessage });
      }
      exported = results.some(function (r) { return r.ok; });
    } finally {
      for (let i = 0; i < texts.length; i++) doc.undo();
    }
    console.log(JSON.stringify({ exported: exported, outlined_text_nodes: texts.length, results: results }));
  } catch (e) {
    console.log(JSON.stringify({ exported: false, target: TARGET, error: String((e && e.message) || e) }));
  }
})();
