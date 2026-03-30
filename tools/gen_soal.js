/**
 * tools/gen_soal.js
 */
const { ollama } = require('../ollama_helper');

// Fix LaTeX commands corrupted by JSON escape sequences
// e.g. \frac → \f (form feed) + rac, \theta → \t (tab) + heta, etc.
function fixLatexEscapes(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\x08/g, '\\b')   // backspace  → \b (e.g. \beta, \binom)
    .replace(/\x0C/g, '\\f')   // form feed  → \f (e.g. \frac, \forall)
    .replace(/\x0D/g, '\\r')   // CR         → \r (e.g. \right, \rangle)
    .replace(/\t/g,   '\\t');   // tab        → \t (e.g. \theta, \text, \times)
  // NOTE: \n (newline) not replaced here — could be legitimate line break
}

function fixLatexInSoal(soalArr) {
  for (const s of soalArr) {
    if (s.soal) s.soal = fixLatexEscapes(s.soal);
    if (s.opsi) {
      for (const k of Object.keys(s.opsi)) {
        if (s.opsi[k]) s.opsi[k] = fixLatexEscapes(s.opsi[k]);
      }
    }
    if (s.kunci) s.kunci = fixLatexEscapes(s.kunci);
    if (s.pembahasan) s.pembahasan = fixLatexEscapes(s.pembahasan);
  }
  return soalArr;
}

const LEVEL_MAP = {
  mudah:    'mudah (C1-C2 Taksonomi Bloom, hafalan dan pemahaman dasar)',
  sedang:   'sedang (C2-C3 Taksonomi Bloom, pemahaman dan penerapan)',
  sulit:    'sulit (C3-C4 Taksonomi Bloom, penerapan dan analisis)',
  campuran: 'campuran C1 hingga C4 Taksonomi Bloom',
};

function buildSystemPrompt(config) {
  const { mapel, kelas, numPG, numES, level, startNo = 1 } = config;
  const levelStr = LEVEL_MAP[level] || LEVEL_MAP.sedang;

  const soalParts = [];
  if (numPG > 0) soalParts.push(`${numPG} soal Pilihan Ganda`);
  if (numES > 0) soalParts.push(`${numES} soal Essay`);

  return `Kamu adalah generator soal ujian profesional untuk SMK Indonesia.
Tugasmu: Buat ${soalParts.join(' dan ')} dari teks materi yang diberikan.

KONFIGURASI:
- Mata Pelajaran: ${mapel} | Kelas: ${kelas}
- Tingkat kesulitan: ${levelStr}

ATURAN:
1. Soal PG harus memiliki 5 opsi (A, B, C, D, E) dengan 1 jawaban benar.
2. Semua soal WAJIB bersumber dari materi.
3. Gunakan Bahasa Indonesia baku.
4. Output HANYA JSON valid.
5. Notasi matematika WAJIB dibungkus dengan $...$ (contoh: $x^2$, $\\frac{a}{b}$).

FORMAT JSON:
{
  "soal": [
    { "no": 1, "tipe": "PG", "soal": "...", "opsi": {"A": "..", "B": "..", "C": "..", "D": "..", "E": ".."}, "kunci": "A", "bobot": 2, "pembahasan": "..." },
    { "no": 2, "tipe": "ES", "soal": "...", "kunci": "...", "bobot": 10, "rubrik": ["..."] }
  ]
}`;
}

async function genSoal(teksMateri, config) {
  const { mapel, kelas, numPG, numES, level } = config;
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
    const soalArr = fixLatexInSoal(parsed.soal || []);

    // Pastikan penomoran benar
    soalArr.forEach((s, i) => { s.no = i + 1; });

    return {
      meta: {
        mapel, kelas,
        topik: soalArr[0]?.soal?.slice(0, 50) || '-',
        total_pg: soalArr.filter(s => s.tipe === 'PG').length,
        total_essay: soalArr.filter(s => s.tipe === 'ES').length,
        total_bobot: soalArr.reduce((sum, s) => sum + (s.bobot || 0), 0),
      },
      soal: soalArr,
    };
  } catch (err) {
    console.error('[gen_soal] Ollama Error:', err.message);
    throw err;
  }
}

module.exports = { genSoal, buildSystemPrompt, fixLatexEscapes, fixLatexInSoal };