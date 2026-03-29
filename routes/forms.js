// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: FORMS — Buat Google Form dari JSON MCP Generator
// ═══════════════════════════════════════════════════════════════════════════════

const { getFormsClientAs, getClassroomClientForCourse, getAdminClient, handleError } = require('../helpers/auth');
const { ADMIN_EMAIL } = require('../config');

// Helper: ambil email owner kelas
async function getCourseOwnerEmail(courseId) {
  try {
    const { getClassroomClient } = require('../helpers/auth');
    const cls    = await getClassroomClient();
    const course = await cls.courses.get({ id: courseId });
    const ownerId = course.data.ownerId;
    if (ownerId?.includes('@')) return ownerId;
    const admin = getAdminClient();
    const u     = await admin.users.get({ userKey: ownerId, projection: 'basic' });
    return u.data.primaryEmail;
  } catch(_) {
    return ADMIN_EMAIL;
  }
}

// Hapus newline dari teks feedback (Forms API tidak support \n di displayed text)
function cleanText(str) {
  return (str || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// Konversi soal MCP JSON → Google Forms API batchUpdate requests
function buildFormRequests(soalList) {
  const requests = [];

  soalList.forEach((soal, idx) => {
    if (soal.tipe === 'PG') {
      const kunciLabel = soal.kunci;
      const kunciValue = `${kunciLabel}. ${soal.opsi[kunciLabel]}`;

      requests.push({
        createItem: {
          item: {
            title: cleanText(soal.soal),
            questionItem: {
              question: {
                required: true,
                grading: {
                  pointValue: soal.bobot,
                  correctAnswers: {
                    answers: [{ value: kunciValue }],
                  },
                  whenRight: { text: 'Jawaban benar!' },
                  whenWrong: { text: cleanText(soal.pembahasan) || `Jawaban yang benar adalah ${kunciValue}` },
                },
                choiceQuestion: {
                  type: 'RADIO',
                  options: Object.entries(soal.opsi).map(([k, v]) => ({
                    value: `${k}. ${cleanText(v)}`,
                  })),
                  shuffle: false,
                },
              },
            },
          },
          location: { index: idx },
        },
      });

    } else if (soal.tipe === 'ES') {
      const rubrikText = Array.isArray(soal.rubrik)
        ? soal.rubrik.map((r, i) => `${i + 1}. ${cleanText(r)}`).join(' | ')
        : cleanText(soal.rubrik || '');

      const feedbackText = rubrikText
        ? `Rubrik: ${rubrikText}`
        : cleanText(soal.kunci || 'Dinilai oleh guru');

      requests.push({
        createItem: {
          item: {
            title: cleanText(soal.soal),
            questionItem: {
              question: {
                required: true,
                grading: {
                  pointValue: soal.bobot,
                  generalFeedback: { text: feedbackText },
                },
                textQuestion: { paragraph: true },
              },
            },
          },
          location: { index: idx },
        },
      });
    }
  });

  return requests;
}

module.exports = function(app) {

  // POST /api/forms/preview — validasi JSON MCP sebelum submit
  app.post('/api/forms/preview', (req, res) => {
    try {
      const { json } = req.body;
      if (!json) return res.status(400).json({ success: false, error: 'json wajib diisi' });

      const data   = typeof json === 'string' ? JSON.parse(json) : json;
      const meta   = data.meta   || {};
      const soal   = data.soal   || [];

      if (!soal.length) {
        return res.status(400).json({ success: false, error: 'Tidak ada soal dalam JSON' });
      }

      const totalPG    = soal.filter(s => s.tipe === 'PG').length;
      const totalEssay = soal.filter(s => s.tipe === 'ES').length;
      const totalBobot = soal.reduce((acc, s) => acc + (s.bobot || 0), 0);

      res.json({
        success: true,
        preview: {
          title:      `${meta.mapel || 'Ujian'} — ${meta.kelas || ''}`.trim(),
          mapel:      meta.mapel,
          kelas:      meta.kelas,
          semester:   meta.semester,
          tahunAjaran: meta.tahun_ajaran,
          waktu:      meta.waktu,
          pembuat:    meta.pembuat,
          totalSoal:  soal.length,
          totalPG,
          totalEssay,
          totalBobot,
          soal: soal.map(s => ({
            no:    s.no,
            tipe:  s.tipe,
            soal:  s.soal.substring(0, 80) + (s.soal.length > 80 ? '...' : ''),
            bobot: s.bobot,
            kunci: s.tipe === 'PG' ? s.kunci : null,
          })),
        },
      });
    } catch(e) {
      res.status(400).json({ success: false, error: 'JSON tidak valid: ' + e.message });
    }
  });

  // POST /api/forms/create — buat Form + opsional lampirkan ke kelas
  app.post('/api/forms/create', async (req, res) => {
    try {
      const { json, courseId, dueDate, dueTime, maxPoints, state = 'PUBLISHED', scheduledTime } = req.body;
      if (!json) return res.status(400).json({ success: false, error: 'json wajib diisi' });

      const data = typeof json === 'string' ? JSON.parse(json) : json;
      const meta = data.meta || {};
      const soal = data.soal || [];

      if (!soal.length) {
        return res.status(400).json({ success: false, error: 'Tidak ada soal dalam JSON' });
      }

      // Debug log
      console.log('[Forms] meta:', JSON.stringify(meta));

      // Tentukan siapa yang akan jadi owner form
      let ownerEmail = ADMIN_EMAIL;
      if (courseId) {
        ownerEmail = await getCourseOwnerEmail(courseId);
      }

      const formsClient = await getFormsClientAs(ownerEmail);

      // Build judul dari meta
      const formTitle = [
        meta.mapel     || null,
        meta.kelas     ? `— ${meta.kelas}` : null,
        meta.semester  ? `| ${meta.semester}` : null,
        meta.tahun_ajaran || null,
      ].filter(Boolean).join(' ') || 'Ujian';

      const formDesc = [
        meta.nama_sekolah ? `Sekolah: ${meta.nama_sekolah}` : '',
        meta.waktu ? `Waktu: ${meta.waktu}` : '',
        meta.pembuat ? `Pembuat: ${meta.pembuat}` : '',
        meta.topik && meta.topik !== '-' ? `Topik: ${meta.topik}` : '',
      ].filter(Boolean).join('\n');

      // 1. Buat form kosong — HANYA title (limitasi API)
      const createRes = await formsClient.forms.create({
        requestBody: { info: { title: formTitle } },
      });

      const formId  = createRes.data.formId;
      const formUrl = `https://docs.google.com/forms/d/${formId}/edit`;
      const viewUrl = createRes.data.responderUri || `https://docs.google.com/forms/d/${formId}/viewform`;

      console.log('[Forms] formTitle:', formTitle, '| formId:', formId);

      // 2. Rename file di Drive SEBELUM batchUpdate (fix "Untitled Form")
      try {
        const { getDriveClientAs } = require('../helpers/auth');
        const driveAs = await getDriveClientAs(ownerEmail);
        await driveAs.files.update({
          fileId:      formId,
          requestBody: { name: formTitle },
        });
        console.log('[Forms] File renamed in Drive to:', formTitle);
      } catch(e) {
        console.warn('[Forms] Gagal rename file di Drive:', e.message);
      }

      // 3. batchUpdate — update title + description + jadikan quiz + semua soal
      const soalRequests = buildFormRequests(soal);

      await formsClient.forms.batchUpdate({
        formId,
        requestBody: {
          requests: [
            {
              updateFormInfo: {
                info: {
                  title:       formTitle,
                  description: formDesc || '',
                },
                updateMask: 'title,description',
              },
            },
            {
              updateSettings: {
                settings: { quizSettings: { isQuiz: true } },
                updateMask: 'quizSettings.isQuiz',
              },
            },
            ...soalRequests,
          ],
        },
      });

      console.log('[Forms] batchUpdate selesai — soal:', soal.length);

      // 4. Opsional: lampirkan ke kelas Classroom sebagai Assignment
      let courseWorkId = null;
      if (courseId) {
        const { getDriveClientAs, getClassroomClientAs } = require('../helpers/auth');

        // Share form ke domain agar semua siswa bisa akses
        try {
          const driveAs = await getDriveClientAs(ownerEmail);
          const domain  = ownerEmail.split('@')[1];
          await driveAs.permissions.create({
            fileId:      formId,
            requestBody: { role: 'reader', type: 'domain', domain },
          });
          console.log(`[Forms] Shared to domain: ${domain}`);
        } catch(e) {
          console.warn('[Forms] Gagal share ke domain:', e.message);
        }

        // Gunakan impersonasi owner kelas
        const classroom  = await getClassroomClientAs(ownerEmail);
        const totalBobot = soal.reduce((acc, s) => acc + (s.bobot || 0), 0);

        const cwBody = {
          title:     formTitle,
          workType:  'ASSIGNMENT',
          state:     scheduledTime ? 'SCHEDULED' : (state || 'PUBLISHED'),
          maxPoints: maxPoints || totalBobot || 100,
          materials: [{
            link: {
              url:   viewUrl,
              title: `📝 ${formTitle}`,
            },
          }],
        };

        // Jadwal rilis
        if (scheduledTime) {
          cwBody.scheduledTime = scheduledTime;
        }

        // Deadline
        if (dueDate) {
          const d = new Date(dueDate);
          cwBody.dueDate = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
          cwBody.dueTime = dueTime
            ? { hours: parseInt(dueTime.split(':')[0]), minutes: parseInt(dueTime.split(':')[1]) }
            : { hours: 23, minutes: 59 };
        }

        console.log(`[Forms] Creating courseWork for course ${courseId} as ${ownerEmail}`);
        const cwRes = await classroom.courses.courseWork.create({
          courseId,
          requestBody: cwBody,
        });
        courseWorkId = cwRes.data.id;
        console.log(`[Forms] CourseWork created: ${courseWorkId}`);
      }

      res.json({
        success:       true,
        formId,
        formUrl,
        viewUrl,
        courseWorkId,
        ownerEmail,
        totalSoal:     soal.length,
        isScheduled:   !!scheduledTime,
        scheduledTime: scheduledTime || null,
      });

    } catch(err) { handleError(res, err); }
  });

};