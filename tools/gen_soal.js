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
1. Soal PG harus memiliki 4 opsi (A, B, C, D) dengan 1 jawaban benar.
2. Semua soal WAJIB bersumber dari materi.
3. Gunakan Bahasa Indonesia baku.
4. Output HANYA JSON valid.

FORMAT JSON:
{
  "soal": [
    { "no": 1, "tipe": "PG", "soal": "...", "opsi": {"A": "..", "B": "..", "C": "..", "D": ".."}, "kunci": "A", "bobot": 2, "pembahasan": "..." },
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
    const soalArr = parsed.soal || [];

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

module.exports = { genSoal, buildSystemPrompt };