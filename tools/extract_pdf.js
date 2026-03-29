/**
 * tools/extract_pdf.js
 * ════════════════════
 * Tool: extract_pdf
 * Parse PDF di worker thread agar event loop server tidak hang.
 */

const { Worker } = require('worker_threads');
const path       = require('path');

const WORKER_PATH = path.join(__dirname, 'extract_pdf_worker.js');
const TIMEOUT     = 45000; // 45 detik

/**
 * Ekstrak teks dari PDF via worker thread.
 * @param {string} filePath  - Path ke file PDF sementara dari multer
 * @returns {Object}
 */
function extractPdf(filePath) {
  console.log('[extract_pdf] Spawn worker thread untuk:', filePath);
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { filePath },
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(`PDF parsing timeout setelah ${TIMEOUT / 1000}s — file mungkin corrupt atau terlalu besar`));
    }, TIMEOUT);

    worker.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (msg.ok) {
        console.log('[extract_pdf] Worker selesai, halaman:', msg.result.total_halaman);
        resolve(msg.result);
      } else {
        reject(new Error(msg.error || 'Gagal parse PDF'));
      }
    });

    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Worker keluar tanpa hasil (code=${code})`));
    });
  });
}

// Fungsi bersihkanTeks tidak diperlukan di sini lagi (ada di worker)
// Dipertahankan untuk kompatibilitas jika diimport langsung
function bersihkanTeks(teks) {
  return teks
    .replace(/\r\n/g, '\n')          // normalize line endings
    .replace(/[ \t]+/g, ' ')          // collapse spasi berulang
    .replace(/\n{3,}/g, '\n\n')       // max 2 baris kosong
    .replace(/[^\x20-\x7E\n\u00C0-\u024F\u0080-\u00BF]/g, '') // hapus karakter aneh
    .trim();
}

module.exports = { extractPdf }