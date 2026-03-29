/**
 * tools/extract_pdf_worker.js
 * ═══════════════════════════
 * Dijalankan sebagai worker thread oleh extract_pdf.js.
 * Parse PDF lalu kirim hasil via parentPort.
 */

const { workerData, parentPort } = require('worker_threads');
const pdfParse = require('pdf-parse');
const fs       = require('fs');

(async () => {
  try {
    const buffer = fs.readFileSync(workerData.filePath);
    const data   = await pdfParse(buffer);

    const rawPages = data.text.split(/\f/);

    const halaman = rawPages
      .map((teks, i) => ({
        halaman: i + 1,
        teks: bersihkanTeks(teks),
      }))
      .filter(h => h.teks.length > 20);

    const teksGabung = halaman.map(h => h.teks).join('\n\n');

    parentPort.postMessage({
      ok: true,
      result: {
        success:         true,
        total_halaman:   data.numpages,
        total_karakter:  teksGabung.length,
        teks_gabung:     teksGabung,
        halaman,
      },
    });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message || String(err) });
  }
})()