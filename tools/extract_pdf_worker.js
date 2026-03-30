/**
 * tools/extract_pdf_worker.js
 * ═══════════════════════════
 * Dijalankan sebagai worker thread oleh extract_pdf.js.
 * Updated untuk pdf-parse v2 (class-based API).
 */

const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');

/**
 * Fungsi pembersihan teks (duplikat dari extract_pdf.js agar worker mandiri).
 */
function bersihkanTeks(teks) {
  return teks
    .replace(/\r\n/g, '\n')          // normalize line endings
    .replace(/[ \t]+/g, ' ')          // collapse spasi berulang
    .replace(/\n{3,}/g, '\n\n')       // max 2 baris kosong
    .replace(/[^\x20-\x7E\n\u00C0-\u024F\u0080-\u00BF]/g, '') // hapus karakter aneh
    .trim();
}

(async () => {
  let parser = null;
  try {
    // Import v2 API (named export)
    const { PDFParse } = require('pdf-parse');

    const buffer = fs.readFileSync(workerData.filePath);

    // Inisialisasi parser dengan buffer
    parser = new PDFParse({ data: buffer });

    // Ekstrak teks (form-feed \f tetap dipertahankan, sama seperti v1)
    const data = await parser.getText();

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
  } finally {
    // Wajib: bebaskan resource (worker, memory)
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }
})();