/**
 * tools/gen_soal.js
 */
const { ollama } = require('../ollama_helper');

const LEVEL_MAP = {
  mudah:    'mudah (C1-C2 Taksonomi Bloom, hafalan dan pemahaman dasar)',
  sedang:   'sedang (C2-C3 Taksonomi Bloom, pemahaman dan penerapan)',
  sulit:    'sulit (C3-C4 Taksonomi Bloom, penerapan dan analisis)',
  campuran: 'campuran C1 hingga C4 Taksonomi Bloom',
};

function buildSystemPrompt(config) {
  const { mapel, kelas, numPG, numES, level,
          withTeksBacaan = false, numTeks = 1, soalPerTeks = 3 } = config;
  const levelStr = LEVEL_MAP[level] || LEVEL_MAP.sedang;
  const soalParts = [];
  if (numPG > 0) soalParts.push(`${numPG} soal Pilihan Ganda`);
  if (numES > 0) soalParts.push(`${numES} soal Essay`);
  const baseRules = `1. Soal PG harus memiliki 5 opsi (A, B, C, D, E) dengan 1 jawaban benar.
2. Semua soal WAJIB bersumber dari materi.
3. Gunakan Bahasa Indonesia baku.
4. Notasi matematika dibungkus dengan $...$  (contoh: $x^2$).
5. Output HANYA JSON valid tanpa teks lain.`;

  if (withTeksBacaan) {
    return `Kamu adalah generator soal ujian profesional untuk SMK Indonesia.
Tugasmu: Buat ${soalParts.join(' dan ')} DENGAN TEKS BACAAN dari materi.

KONFIGURASI:
- Mata Pelajaran: ${mapel} | Kelas: ${kelas}
- Tingkat kesulitan: ${levelStr}
- Jumlah teks bacaan: ${numTeks}
- Soal per teks bacaan: ${soalPerTeks}

ATURAN:
${baseRules}
6. Buat ${numTeks} teks bacaan dari materi (minimal 3 paragraf).
7. Setiap teks diikuti ${soalPerTeks} soal yang mengacu ke teks tersebut.
8. Sisa soal (jika ada) boleh tanpa teks (teks_bacaan_id: null).

FORMAT JSON:
{
  "teks_bacaan": [
    { "id": "teks-1", "judul": "...", "teks": "isi teks..." }
  ],
  "soal": [
    { "no": 1, "teks_bacaan_id": "teks-1", "tipe": "PG", "soal": "...", "opsi": {"A":"..","B":"..","C":"..","D":"..","E":".."}, "kunci": "A", "bobot": 2 },
    { "no": 2, "teks_bacaan_id": null, "tipe": "ES", "soal": "...", "kunci": "...", "bobot": 10 }
  ]
}`;
  }

  return `Kamu adalah generator soal ujian profesional untuk SMK Indonesia.
Tugasmu: Buat ${soalParts.join(' dan ')} dari teks materi yang diberikan.

KONFIGURASI:
- Mata Pelajaran: ${mapel} | Kelas: ${kelas}
- Tingkat kesulitan: ${levelStr}

ATURAN:
${baseRules}

FORMAT JSON:
{
  "soal": [
    { "no": 1, "tipe": "PG", "soal": "...", "opsi": {"A": "..", "B": "..", "C": "..", "D": "..", "E": ".."}, "kunci": "A", "bobot": 2, "pembahasan": "..." },
    { "no": 2, "tipe": "ES", "soal": "...", "kunci": "...", "bobot": 10 }
  ]
}`;
}

async function genSoal(teksMateri, config) {
  const { mapel, kelas, numPG, numES, level,
          withTeksBacaan = false, numTeks = 1, soalPerTeks = 3 } = config;
  const model = process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';
  
  // Ambil potongan materi (Ollama lokal biasanya punya limit context window)
  const teksInput = teksMateri.slice(0, 8000); 

  console.log(`[gen_soal] Memanggil Ollama (${model})...`);

  try {
    const response = await ollama.chat({
      model: model,
      messages: [
        { role: 'system', content: buildSystemPrompt(config) },
        { role: 'user', content: `Berikut materinya:\n\n${teksInput}` }
      ],
      format: 'json',
      stream: false
    });

    const parsed = JSON.parse(response.message.content);
    const soalArr    = parsed.soal || [];
    const teksBacaan = parsed.teks_bacaan || [];

    // Inject teks_bacaan ke soal yang mereferensikannya
    if (teksBacaan.length) {
      const teksMap = {};
      teksBacaan.forEach(t => { teksMap[t.id] = t.teks; });
      soalArr.forEach(s => {
        if (s.teks_bacaan_id && teksMap[s.teks_bacaan_id]) {
          s.teks_bacaan = teksMap[s.teks_bacaan_id];
        }
      });
    }

    // Pastikan penomoran benar
    soalArr.forEach((s, i) => { s.no = i + 1; });

    return {
      meta: {
        mapel, kelas,
        topik: soalArr[0]?.soal?.slice(0, 50) || '-',
        total_pg:    soalArr.filter(s => s.tipe === 'PG').length,
        total_essay: soalArr.filter(s => s.tipe === 'ES').length,
        total_bobot: soalArr.reduce((sum, s) => sum + (s.bobot || 0), 0),
        has_teks_bacaan: teksBacaan.length > 0,
      },
      soal: soalArr,
      teks_bacaan: teksBacaan,
    };
  } catch (err) {
    console.error('[gen_soal] Ollama Error:', err.message);
    throw err;
  }
}

// ── Fix LaTeX — pastikan notasi math terbungkus $...$ ────────────────────────
// Dipanggil sebelum soal disimpan ke cbt_soal agar KaTeX bisa render
function fixLatexInSoal(soalArr) {
  if (!Array.isArray(soalArr)) return soalArr;

  // Pattern yang menandakan ada notasi matematika tapi belum dibungkus $
  const latexPatterns = [
    /\^[0-9a-zA-Z]+\\log/,   // ^5\log
    /\\frac\{/,               // \frac{
    /\\sqrt\{/,               // \sqrt{
    /\\sum_/,                 // \sum_
    /\\int_/,                 // \int_
    /\\alpha|\\beta|\\theta|\\pi/, // huruf Yunani
    /[a-zA-Z]_\{?\d/,         // subscript: x_1, a_{ij}
  ];

  function needsWrap(text) {
    if (!text || typeof text !== 'string') return false;
    if (text.includes('$')) return false; // sudah ada delimiter
    return latexPatterns.some(p => p.test(text));
  }

  function wrapIfNeeded(text) {
    if (!needsWrap(text)) return text;
    // Bungkus seluruh ekspresi matematika dengan $...$
    // Pisah per bagian: teks biasa | ekspresi math
    return text.replace(
      /((?:\^[0-9]+)?\\[a-zA-Z]+(?:\{[^}]*\})*(?:\s*[+\-*/=]\s*(?:\^[0-9]+)?\\[a-zA-Z]+(?:\{[^}]*\})*)*)/g,
      '$$$1$$$'
    );
  }

  return soalArr.map(s => ({
    ...s,
    soal:   wrapIfNeeded(s.soal),
    opsi_a: wrapIfNeeded(s.opsi_a),
    opsi_b: wrapIfNeeded(s.opsi_b),
    opsi_c: wrapIfNeeded(s.opsi_c),
    opsi_d: wrapIfNeeded(s.opsi_d),
    opsi_e: wrapIfNeeded(s.opsi_e),
    // Jika format opsi adalah object {A,B,C,D,E}
    opsi: s.opsi ? {
      A: wrapIfNeeded(s.opsi.A),
      B: wrapIfNeeded(s.opsi.B),
      C: wrapIfNeeded(s.opsi.C),
      D: wrapIfNeeded(s.opsi.D),
      E: wrapIfNeeded(s.opsi.E),
    } : undefined,
  }));
}

module.exports = { genSoal, buildSystemPrompt, fixLatexInSoal };