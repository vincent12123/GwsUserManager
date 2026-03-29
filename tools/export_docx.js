/**
 * tools/export_docx.js
 * ════════════════════
 * Tool: export_docx
 * Port dari generate_soal.py — terima JSON soal → generate file .docx
 * Menggunakan library 'docx' (npm).
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, HeadingLevel, WidthType, ShadingType,
  convertInchesToTwip,
} = require('docx');
const path = require('path');
const fs   = require('fs');

/**
 * Generate file .docx dari JSON soal.
 *
 * @param {Object} dataSoal   - JSON output dari gen_soal
 * @param {Object} pengaturan - { namaSekolah, semester, tahunAjaran, waktu, pembuat }
 * @param {string} outputDir  - Folder tujuan simpan file
 * @returns {string}          - Path file .docx yang dibuat
 */
async function exportDocx(dataSoal, pengaturan = {}, outputDir = './outputs') {
  const {
    namaSekolah  = 'SMK',
    semester     = 'Ganjil',
    tahunAjaran  = '2025/2026',
    waktu        = '90 menit',
    pembuat      = 'Guru',
  } = pengaturan;

  const { mapel, kelas, topik, total_bobot } = dataSoal.meta;
  const soalList = dataSoal.soal;
  const pgList   = soalList.filter(s => s.tipe === 'PG');
  const esList   = soalList.filter(s => s.tipe === 'ES');

  // ── Helpers ──────────────────────────────────────────
  const teks = (text, opts = {}) => new TextRun({
    text: String(text || ''),
    font: 'Arial',
    size: opts.size || 22,          // half-points: 22 = 11pt
    bold:    opts.bold    || false,
    italic:  opts.italic  || false,
    color:   opts.color   || '000000',
    ...opts,
  });

  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: {
      before: opts.before || 0,
      after:  opts.after  || 80,
    },
    ...opts,
  });

  const hr = () => new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
    spacing: { before: 60, after: 60 },
    children: [],
  });

  // ── Header Sekolah ────────────────────────────────────
  const headerSection = [
    para(teks(namaSekolah.toUpperCase(), { bold: true, size: 28, color: '1F4E79' }),
      { align: AlignmentType.CENTER, after: 20 }),
    para(teks(`PENILAIAN AKHIR SEMESTER ${semester.toUpperCase()}`, { bold: true, size: 24 }),
      { align: AlignmentType.CENTER, after: 20 }),
    para(teks(`Tahun Ajaran ${tahunAjaran}`, { size: 20 }),
      { align: AlignmentType.CENTER, after: 120 }),
    hr(),
  ];

  // ── Tabel Info Ujian ──────────────────────────────────
  const infoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:    { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left:   { style: BorderStyle.NONE },
      right:  { style: BorderStyle.NONE },
      insideH:{ style: BorderStyle.NONE },
      insideV:{ style: BorderStyle.NONE },
    },
    rows: [
      makeInfoRow('Mata Pelajaran', ': ' + mapel,           'Waktu',       ': ' + waktu),
      makeInfoRow('Kelas',          ': ' + kelas,           'Hari/Tanggal',': ................................'),
      makeInfoRow('Topik',          ': ' + (topik || '-'),  'Nama Siswa',  ': ................................'),
      makeInfoRow('Total Soal',     ': ' + pgList.length + ' PG + ' + esList.length + ' Essay', 'No. Absen', ': ................................'),
    ],
  });

  function makeInfoRow(k1, v1, k2, v2) {
    return new TableRow({
      children: [
        new TableCell({ children: [para(teks(k1, { size: 20 }), { after: 20 })] , width: { size: 20, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [para(teks(v1, { size: 20 }), { after: 20 })] , width: { size: 30, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [para(teks(k2, { size: 20 }), { after: 20 })] , width: { size: 20, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [para(teks(v2, { size: 20 }), { after: 20 })] , width: { size: 30, type: WidthType.PERCENTAGE } }),
      ],
    });
  }

  // ── Petunjuk ──────────────────────────────────────────
  const petunjukSection = [
    new Paragraph({ children: [], spacing: { before: 200, after: 0 } }),
    para(teks('PETUNJUK PENGERJAAN:', { bold: true, size: 22 }), { after: 60 }),
    para([teks('A.  ', { bold: true, size: 20 }), teks('Pilihan Ganda: Pilih satu jawaban yang paling tepat dengan memberi tanda silang (X) pada huruf A, B, C, atau D.', { size: 20 })], { after: 40 }),
    para([teks('B.  ', { bold: true, size: 20 }), teks('Essay: Jawablah dengan lengkap dan jelas pada lembar jawaban yang tersedia.', { size: 20 })], { after: 0 }),
    hr(),
  ];

  // ── Soal PG ───────────────────────────────────────────
  const pgSection = [];

  if (pgList.length > 0) {
    pgSection.push(
      para(teks('A. PILIHAN GANDA', { bold: true, size: 24, color: '1F4E79' }),
        { before: 120, after: 80 })
    );

    pgList.forEach((s, idx) => {
      // Nomor + teks soal
      pgSection.push(
        para([
          teks(`${idx + 1}.  `, { bold: true, size: 22 }),
          teks(s.soal, { size: 22 }),
        ], { before: idx === 0 ? 0 : 60, after: 40 })
      );

      // Opsi A-D
      ['A', 'B', 'C', 'D'].forEach(huruf => {
        const teksOpsi = s.opsi?.[huruf] || '';
        pgSection.push(
          para([
            teks(`        ${huruf}.  `, { size: 20 }),
            teks(teksOpsi, { size: 20 }),
          ], { after: 20 })
        );
      });
    });
  }

  // ── Soal Essay ────────────────────────────────────────
  const esSection = [];

  if (esList.length > 0) {
    esSection.push(hr());
    esSection.push(
      para(teks('B. ESSAY', { bold: true, size: 24, color: '1F4E79' }),
        { before: 120, after: 80 })
    );

    esList.forEach((s, idx) => {
      const noGlobal = pgList.length + idx + 1;
      esSection.push(
        para([
          teks(`${noGlobal}.  `, { bold: true, size: 22 }),
          teks(s.soal, { size: 22 }),
        ], { before: idx === 0 ? 0 : 80, after: 40 })
      );
      // Ruang jawaban
      for (let i = 0; i < 5; i++) {
        esSection.push(
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
            spacing: { before: 0, after: 60 },
          })
        );
      }
    });
  }

  // ── Footer ────────────────────────────────────────────
  const footerSection = [
    hr(),
    para([
      teks('Total Bobot: ', { bold: true, size: 18 }),
      teks(`${total_bobot} poin`, { size: 18 }),
      teks('     |     ', { size: 18, color: '999999' }),
      teks('Dibuat oleh: ', { bold: true, size: 18 }),
      teks(pembuat, { size: 18 }),
    ], { align: AlignmentType.CENTER, before: 120 }),
  ];

  // ── Assemble Document ─────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left:   convertInchesToTwip(1.2),
            right:  convertInchesToTwip(1.2),
          },
        },
      },
      children: [
        ...headerSection,
        infoTable,
        ...petunjukSection,
        ...pgSection,
        ...esSection,
        ...footerSection,
      ],
    }],
  });

  // ── Simpan file ───────────────────────────────────────
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const safeName  = mapel.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
  const filename  = `Soal_${safeName}_${kelas.replace(/\s/g,'')}_${timestamp}.docx`;
  const filePath  = path.join(outputDir, filename);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);

  return { filePath, filename, ukuran: buffer.length };
}

// ── Export Kunci Jawaban ──────────────────────────────────
/**
 * Generate file .docx KUNCI JAWABAN (untuk guru).
 */
async function exportKunci(dataSoal, pengaturan = {}, outputDir = './outputs') {
  const { mapel, kelas, topik } = dataSoal.meta;
  const { pembuat = 'Guru', namaSekolah = 'SMK' } = pengaturan;
  const soalList = dataSoal.soal;
  const pgList   = soalList.filter(s => s.tipe === 'PG');
  const esList   = soalList.filter(s => s.tipe === 'ES');

  const teks = (text, opts = {}) => new TextRun({
    text: String(text || ''), font: 'Arial',
    size: opts.size || 22, bold: opts.bold || false,
    color: opts.color || '000000', ...opts,
  });
  const para = (children, opts = {}) => new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: opts.before || 0, after: opts.after || 80 },
  });

  const children = [
    para(teks('KUNCI JAWABAN & RUBRIK PENILAIAN', { bold: true, size: 26, color: '1F4E79' }),
      { align: AlignmentType.CENTER, after: 40 }),
    para(teks(`${mapel} — ${kelas} | ${namaSekolah}`, { size: 20 }),
      { align: AlignmentType.CENTER, after: 160 }),

    para(teks('A. KUNCI PILIHAN GANDA', { bold: true, size: 22, color: '1F4E79' }),
      { after: 80 }),
  ];

  // Grid kunci PG
  const kunciRows = [];
  for (let i = 0; i < pgList.length; i += 5) {
    const chunk = pgList.slice(i, i + 5);
    kunciRows.push(new TableRow({
      children: chunk.map((s, j) => new TableCell({
        shading: { type: ShadingType.CLEAR, fill: j % 2 === 0 ? 'EEF2FF' : 'FFFFFF' },
        children: [para([
          teks(`${s.no}. `, { bold: true, size: 20 }),
          teks(s.kunci, { bold: true, size: 20, color: '1F4E79' }),
        ], { after: 20 })],
        width: { size: 20, type: WidthType.PERCENTAGE },
      })),
    }));
  }

  if (kunciRows.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: kunciRows,
    }));
  }

  // Pembahasan PG
  children.push(para(teks(''), { before: 160 }));
  children.push(para(teks('Pembahasan PG:', { bold: true, size: 20, color: '1F4E79' }), { after: 60 }));
  pgList.forEach(s => {
    children.push(para([
      teks(`${s.no}. `, { bold: true, size: 20 }),
      teks(`Jawaban: ${s.kunci} — `, { bold: true, size: 20 }),
      teks(s.pembahasan || '-', { size: 20 }),
    ], { after: 40 }));
  });

  // Rubrik Essay
  if (esList.length > 0) {
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
      spacing: { before: 120, after: 80 }, children: [],
    }));
    children.push(para(teks('B. RUBRIK PENILAIAN ESSAY', { bold: true, size: 22, color: '1F4E79' }),
      { after: 80 }));

    esList.forEach(s => {
      children.push(para([
        teks(`No. ${s.no}  `, { bold: true, size: 22 }),
        teks(`(Bobot: ${s.bobot} poin)`, { size: 20, color: '666666' }),
      ], { before: 80, after: 40 }));
      children.push(para(teks(`Soal: ${s.soal}`, { size: 20, italic: true }), { after: 40 }));
      children.push(para(teks(`Kunci Jawaban:`, { bold: true, size: 20 }), { after: 20 }));
      children.push(para(teks(s.kunci || '-', { size: 20 }), { after: 40 }));

      if (s.rubrik?.length) {
        children.push(para(teks(`Rubrik Penilaian:`, { bold: true, size: 20 }), { after: 20 }));
        s.rubrik.forEach((r, i) => {
          children.push(para([
            teks(`  ${i + 1}.  `, { bold: true, size: 20 }),
            teks(r, { size: 20 }),
          ], { after: 20 }));
        });
      }
    });
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1), bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2),
          },
        },
      },
      children,
    }],
  });

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const safeName  = mapel.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
  const filename  = `Kunci_${safeName}_${kelas.replace(/\s/g,'')}_${timestamp}.docx`;
  const filePath  = path.join(outputDir, filename);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);

  return { filePath, filename, ukuran: buffer.length };
}

module.exports = { exportDocx, exportKunci }