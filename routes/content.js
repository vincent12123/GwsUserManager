// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: CONTENT (4B) — Announcements, CourseWork, Grades Export
// ═══════════════════════════════════════════════════════════════════════════════

const { getClassroomClient, getClassroomClientAs, getAdminClient, getDriveClient, getSheetsClient, handleError } = require('../helpers/auth');
const { ADMIN_EMAIL } = require('../config');

// Helper: ambil email owner kelas, lalu return classroom client yang diimpersonate sebagai owner
async function getClassroomClientForCourse(courseId) {
  try {
    const adminCls  = await getClassroomClient();
    const course    = await adminCls.courses.get({ id: courseId });
    const ownerId   = course.data.ownerId;

    let ownerEmail = ownerId?.includes('@') ? ownerId : null;
    if (!ownerEmail) {
      const admin = getAdminClient();
      const u     = await admin.users.get({ userKey: ownerId, projection: 'basic' });
      ownerEmail  = u.data.primaryEmail;
    }

    console.log(`[ClassroomClient] Course "${course.data.name}" → impersonate ${ownerEmail}`);
    return await getClassroomClientAs(ownerEmail);
  } catch(err) {
    console.error('[getClassroomClientForCourse] Gagal resolve owner, fallback ke admin:', err.message);
    return getClassroomClient();
  }
}

module.exports = function(app) {

  // ─────────────────────────────────────────────────────────────────────────────
  // ANNOUNCEMENTS
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/classroom/courses/:id/announcements
  app.get('/api/classroom/courses/:id/announcements', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.id);
      const r = await classroom.courses.announcements.list({
        courseId:   req.params.id,
        pageSize:   20,
        orderBy:    'updateTime desc',
        announcementStates: ['PUBLISHED', 'DRAFT'],
      });
      res.json({ success: true, data: r.data.announcements || [] });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses/:id/announcements — kirim ke 1 kelas
  app.post('/api/classroom/courses/:id/announcements', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.id);
      const { text, state = 'PUBLISHED', scheduledTime } = req.body;
      if (!text) return res.status(400).json({ success: false, error: 'text wajib diisi' });

      const requestBody = {
        text,
        state: scheduledTime ? 'SCHEDULED' : state,
      };
      if (scheduledTime) requestBody.scheduledTime = scheduledTime;

      const r = await classroom.courses.announcements.create({
        courseId: req.params.id,
        requestBody,
      });
      res.json({ success: true, data: r.data });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/announcements/broadcast — kirim ke banyak kelas sekaligus
  app.post('/api/classroom/announcements/broadcast', async (req, res) => {
    try {
      const classroom = await getClassroomClient(); // fallback, dioverride per kelas di loop
      const { text, courseIds, state = 'PUBLISHED', scheduledTime } = req.body;
      if (!text || !courseIds?.length) {
        return res.status(400).json({ success: false, error: 'text dan courseIds wajib diisi' });
      }

      const requestBody = {
        text,
        state: scheduledTime ? 'SCHEDULED' : state,
      };
      if (scheduledTime) requestBody.scheduledTime = scheduledTime;

      const results = { success: [], failed: [] };
      for (const courseId of courseIds) {
        try {
          const cls = await getClassroomClientForCourse(courseId);
          await cls.courses.announcements.create({ courseId, requestBody });
          results.success.push(courseId);
        } catch(e) {
          results.failed.push({ courseId, error: e.errors?.[0]?.message || e.message });
        }
      }

      res.json({
        success: true,
        totalSuccess: results.success.length,
        totalFailed:  results.failed.length,
        results,
      });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/classroom/courses/:courseId/announcements/:id
  app.delete('/api/classroom/courses/:courseId/announcements/:id', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.courseId);
      await classroom.courses.announcements.delete({
        courseId: req.params.courseId,
        id:       req.params.id,
      });
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // COURSEWORK (TUGAS)
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/classroom/courses/:id/coursework
  app.get('/api/classroom/courses/:id/coursework', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.id);
      const r = await classroom.courses.courseWork.list({
        courseId:         req.params.id,
        pageSize:         20,
        orderBy:          'updateTime desc',
        courseWorkStates: ['PUBLISHED', 'DRAFT'],
      });
      res.json({ success: true, data: r.data.courseWork || [] });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses/:id/coursework — buat tugas baru
  app.post('/api/classroom/courses/:id/coursework', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.id);
      const {
        title, description, workType = 'ASSIGNMENT',
        dueDate, dueTime, maxPoints = 100,
        state = 'PUBLISHED', driveFileId, choices = [], topicId,
      } = req.body;

      if (!title) return res.status(400).json({ success: false, error: 'title wajib diisi' });

      // Validasi pilihan ganda
      if (workType === 'MULTIPLE_CHOICE_QUESTION' && (!choices || choices.length < 2)) {
        return res.status(400).json({ success: false, error: 'Pilihan ganda minimal harus 2 pilihan' });
      }

      const requestBody = {
        title,
        description: description || '',
        workType,
        state,
        maxPoints,
      };

      // Multiple choice choices
      if (workType === 'MULTIPLE_CHOICE_QUESTION') {
        requestBody.multipleChoiceQuestion = { choices };
      }

      // Tambah due date jika ada
      if (dueDate) {
        const d = new Date(dueDate);
        requestBody.dueDate = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
        requestBody.dueTime = dueTime
          ? { hours: parseInt(dueTime.split(':')[0]), minutes: parseInt(dueTime.split(':')[1]) }
          : { hours: 23, minutes: 59 };
      }

      // Lampiran Drive jika ada (hanya untuk ASSIGNMENT)
      if (driveFileId && workType === 'ASSIGNMENT') {
        requestBody.materials = [{
          driveFile: {
            driveFile: { id: driveFileId },
            shareMode: 'VIEW',
          }
        }];
      }

      // Topik jika dipilih
      if (topicId) requestBody.topicId = topicId;

      const r = await classroom.courses.courseWork.create({
        courseId: req.params.id,
        requestBody,
      });

      res.json({ success: true, data: r.data });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/classroom/courses/:courseId/coursework/:id
  app.delete('/api/classroom/courses/:courseId/coursework/:id', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.courseId);
      await classroom.courses.courseWork.delete({
        courseId: req.params.courseId,
        id:       req.params.id,
      });
      res.json({ success: true });
    } catch(err) {
      const reason = err.errors?.[0]?.reason || '';
      if (reason === 'projectPermissionDenied' || err.message?.includes('ProjectPermissionDenied')) {
        return res.status(403).json({
          success: false,
          error: 'Tugas ini tidak bisa dihapus via API karena dibuat dari aplikasi/project lain (bukan GWS Manager). Hapus langsung dari Google Classroom.',
        });
      }
      handleError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUBMISSIONS & GRADING
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/classroom/courses/:courseId/coursework/:workId/submissions
  // Enriched: join dengan data siswa supaya ada nama & email
  app.get('/api/classroom/courses/:courseId/coursework/:workId/submissions', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.courseId);
      const admin     = getAdminClient();

      // Ambil semua submissions
      let submissions = [], pageToken = null;
      do {
        const params = { courseId: req.params.courseId, courseWorkId: req.params.workId, pageSize: 100 };
        if (pageToken) params.pageToken = pageToken;
        const r   = await classroom.courses.courseWork.studentSubmissions.list(params);
        submissions = submissions.concat(r.data.studentSubmissions || []);
        pageToken   = r.data.nextPageToken || null;
      } while (pageToken);

      // Ambil semua siswa di kelas untuk enrich nama & email
      const stuRes  = await classroom.courses.students.list({ courseId: req.params.courseId, pageSize: 200 });
      const stuMap  = {};
      for (const s of stuRes.data.students || []) {
        stuMap[s.userId] = {
          name:  s.profile?.name?.fullName  || s.userId,
          email: s.profile?.emailAddress    || '',
        };
      }

      const data = submissions.map(sub => ({
        id:             sub.id,
        userId:         sub.userId,
        name:           stuMap[sub.userId]?.name  || sub.userId,
        email:          stuMap[sub.userId]?.email || '',
        state:          sub.state,           // CREATED, TURNED_IN, RETURNED
        assignedGrade:  sub.assignedGrade ?? null,
        draftGrade:     sub.draftGrade     ?? null,
        late:           sub.late           || false,
        updateTime:     sub.updateTime,
      }));

      res.json({ success: true, data });
    } catch(err) { handleError(res, err); }
  });

  // PATCH /api/classroom/courses/:courseId/coursework/:workId/submissions/:subId/grade
  // Input nilai siswa
  app.patch('/api/classroom/courses/:courseId/coursework/:workId/submissions/:subId/grade', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.courseId);
      const { assignedGrade } = req.body;
      if (assignedGrade === undefined || assignedGrade === null) {
        return res.status(400).json({ success: false, error: 'assignedGrade wajib diisi' });
      }

      const r = await classroom.courses.courseWork.studentSubmissions.patch({
        courseId:     req.params.courseId,
        courseWorkId: req.params.workId,
        id:           req.params.subId,
        updateMask:   'assignedGrade',
        requestBody:  { assignedGrade: Number(assignedGrade) },
      });

      res.json({ success: true, data: r.data });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses/:courseId/coursework/:workId/submissions/:subId/return
  // Return submission ke siswa (agar bisa lihat nilai)
  app.post('/api/classroom/courses/:courseId/coursework/:workId/submissions/:subId/return', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.courseId);
      await classroom.courses.courseWork.studentSubmissions.return({
        courseId:     req.params.courseId,
        courseWorkId: req.params.workId,
        id:           req.params.subId,
        requestBody:  {},
      });
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TOPICS
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/classroom/courses/:id/topics
  app.get('/api/classroom/courses/:id/topics', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.id);
      const r = await classroom.courses.topics.list({ courseId: req.params.id, pageSize: 100 });
      res.json({ success: true, data: r.data.topic || [] });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses/:id/topics
  app.post('/api/classroom/courses/:id/topics', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.id);
      const { name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'name wajib diisi' });
      const r = await classroom.courses.topics.create({
        courseId:    req.params.id,
        requestBody: { name },
      });
      res.json({ success: true, data: r.data });
    } catch(err) { handleError(res, err); }
  });

  // PATCH /api/classroom/courses/:courseId/topics/:topicId
  app.patch('/api/classroom/courses/:courseId/topics/:topicId', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.courseId);
      const { name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'name wajib diisi' });
      const r = await classroom.courses.topics.patch({
        courseId:    req.params.courseId,
        id:          req.params.topicId,
        updateMask:  'name',
        requestBody: { name },
      });
      res.json({ success: true, data: r.data });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/classroom/courses/:courseId/topics/:topicId
  app.delete('/api/classroom/courses/:courseId/topics/:topicId', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.courseId);
      await classroom.courses.topics.delete({
        courseId: req.params.courseId,
        id:       req.params.topicId,
      });
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses/:courseId/grades/export — export nilai ke Sheets
  app.post('/api/classroom/courses/:courseId/grades/export', async (req, res) => {
    try {
      const classroom = await getClassroomClientForCourse(req.params.courseId);
      const sheets    = await getSheetsClient();
      const drive     = await getDriveClient();

      // 1. Ambil semua coursework
      const cwRes = await classroom.courses.courseWork.list({
        courseId: req.params.courseId, pageSize: 50,
      });
      const works = cwRes.data.courseWork || [];
      if (!works.length) {
        return res.status(400).json({ success: false, error: 'Tidak ada tugas di kelas ini' });
      }

      // 2. Ambil semua siswa
      const stuRes = await classroom.courses.students.list({
        courseId: req.params.courseId, pageSize: 200,
      });
      const students = stuRes.data.students || [];

      // 3. Build grade map { userId: { workId: { grade, state } } }
      const gradeMap = {};
      for (const work of works) {
        const subRes = await classroom.courses.courseWork.studentSubmissions.list({
          courseId: req.params.courseId, courseWorkId: work.id, pageSize: 200,
        });
        for (const sub of subRes.data.studentSubmissions || []) {
          if (!gradeMap[sub.userId]) gradeMap[sub.userId] = {};
          gradeMap[sub.userId][work.id] = {
            grade: sub.assignedGrade,          // null = belum dinilai
            state: sub.state,                  // TURNED_IN, RETURNED, CREATED, etc.
          };
        }
      }

      // 4. Build spreadsheet data
      // Format nilai: angka jika ada, 'Belum dinilai' jika sudah kumpul, 'Belum kumpul' jika belum
      function gradeLabel(entry) {
        if (!entry) return 'Belum kumpul';
        if (entry.grade !== null && entry.grade !== undefined) return entry.grade;
        if (entry.state === 'TURNED_IN' || entry.state === 'RETURNED') return 'Belum dinilai';
        return 'Belum kumpul';
      }

      const header = ['Nama Siswa', 'Email', ...works.map(w => w.title)];
      const rows   = students.map(s => {
        const uid    = s.userId;
        const name   = s.profile?.name?.fullName || uid;
        const email  = s.profile?.emailAddress   || uid;
        const grades = works.map(w => String(gradeLabel(gradeMap[uid]?.[w.id])));
        return [name, email, ...grades];
      });

      // 5. Judul file — per kelas (bukan per tanggal) supaya bisa di-overwrite
      const courseRes  = await classroom.courses.get({ id: req.params.courseId });
      const courseName = courseRes.data.name || 'Kelas';
      const fileTitle  = `[GWS Manager] Nilai — ${courseName}`;

      // 6. Cek apakah sudah ada file dengan nama yang sama di Drive
      const existing = await drive.files.list({
        q:      `name='${fileTitle}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      const rowData = [header, ...rows].map(row => ({
        values: row.map(v => ({
          userEnteredValue: typeof v === 'number'
            ? { numberValue: v }
            : { stringValue: String(v) }
        }))
      }));

      let ssId, isNew = false;

      if (existing.data.files?.length) {
        // Update file yang sudah ada — clear dulu lalu tulis ulang
        ssId = existing.data.files[0].id;
        await sheets.spreadsheets.values.clear({
          spreadsheetId: ssId,
          range: 'Rekap Nilai',
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId: ssId,
          range: 'Rekap Nilai!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [header, ...rows].map(row =>
              row.map(v => typeof v === 'number' ? v : String(v))
            ),
          },
        });
      } else {
        // Buat file baru
        isNew = true;
        const ss = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: fileTitle },
            sheets: [{
              properties: { title: 'Rekap Nilai' },
              data: [{ startRow: 0, startColumn: 0, rowData }],
            }],
          },
        });
        ssId = ss.data.spreadsheetId;

        // Share ke admin
        await drive.permissions.create({
          fileId:      ssId,
          requestBody: { role: 'writer', type: 'user', emailAddress: ADMIN_EMAIL },
        });
      }

      const ssUrl = `https://docs.google.com/spreadsheets/d/${ssId}`;
      res.json({
        success: true,
        spreadsheetId: ssId,
        url:    ssUrl,
        title:  fileTitle,
        isNew,
        totalStudents: students.length,
        totalWorks:    works.length,
      });
    } catch(err) { handleError(res, err); }
  });

};