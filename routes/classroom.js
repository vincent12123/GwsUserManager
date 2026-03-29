// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: CLASSROOM — /api/classroom/*
// ═══════════════════════════════════════════════════════════════════════════════

const { getClassroomClient, getClassroomClientAs, getAdminClient, getDriveClientAs, handleError } = require('../helpers/auth');

module.exports = function(app) {

  // GET /api/classroom/courses
  app.get('/api/classroom/courses', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      const admin     = getAdminClient();

      let courses = [], pageToken = null;
      do {
        const params = { pageSize: 50 };
        if (pageToken) params.pageToken = pageToken;
        const r = await classroom.courses.list(params);
        courses   = courses.concat(r.data.courses || []);
        pageToken = r.data.nextPageToken || null;
      } while (pageToken);

      const result = await Promise.all(courses.map(async c => {
        let teacherEmail = '';
        try {
          const t  = await classroom.courses.teachers.get({ courseId: c.id, userId: c.ownerId });
          teacherEmail = t.data.profile?.emailAddress || '';
        } catch(_) {}
        if (!teacherEmail) {
          try {
            const u  = await admin.users.get({ userKey: c.ownerId, projection: 'basic' });
            teacherEmail = u.data.primaryEmail || '';
          } catch(_) {}
        }
        if (!teacherEmail && c.ownerId?.includes('@')) teacherEmail = c.ownerId;
        return {
          id: c.id, name: c.name, section: c.section || '-',
          state: c.courseState, email: teacherEmail || '-',
          enrollmentCode: c.enrollmentCode || '-', creationTime: c.creationTime,
        };
      }));

      res.json({ success: true, data: result });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses
  app.post('/api/classroom/courses', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      const { name, section, teacherEmail, studentEmails } = req.body;
      if (!name || !teacherEmail) {
        return res.status(400).json({ success: false, error: 'name dan teacherEmail wajib diisi' });
      }
      const created = await classroom.courses.create({
        requestBody: { name, section: section || '', ownerId: teacherEmail, courseState: 'ACTIVE' }
      });
      const courseId = created.data.id;
      const failed   = [];
      if (studentEmails?.length) {
        for (const email of studentEmails) {
          try {
            await classroom.courses.students.create({ courseId, requestBody: { userId: email.trim() } });
          } catch(e) { failed.push({ email, reason: e.message }); }
        }
      }
      res.json({ success: true, courseId, failedStudents: failed });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/classroom/courses/:id
  app.delete('/api/classroom/courses/:id', async (req, res) => {
    try {
      const classroom = await getClassroomClient();

      // 1. Ambil info kelas dulu — untuk dapat teacherFolder.id dan owner
      let folderId   = null;
      let ownerEmail = null;
      try {
        const course  = await classroom.courses.get({ id: req.params.id });
        folderId      = course.data.teacherFolder?.id || null;
        const ownerId = course.data.ownerId;
        if (ownerId?.includes('@')) {
          ownerEmail = ownerId;
        } else {
          const admin = getAdminClient();
          const u     = await admin.users.get({ userKey: ownerId, projection: 'basic' });
          ownerEmail  = u.data.primaryEmail;
        }
      } catch(e) {
        console.warn('[DeleteCourse] Gagal ambil info kelas:', e.message);
      }

      // 2. Archive dulu (wajib sebelum delete)
      try {
        await classroom.courses.patch({
          id: req.params.id, updateMask: 'courseState',
          requestBody: { courseState: 'ARCHIVED' }
        });
      } catch(_) {}

      // 3. Hapus kelas dari Classroom
      await classroom.courses.delete({ id: req.params.id });
      console.log(`[DeleteCourse] Kelas ${req.params.id} berhasil dihapus`);

      // 4. Pindahkan folder Drive ke Trash (kalau ada)
      let folderTrashed = false;
      if (folderId && ownerEmail) {
        try {
          const drive = await getDriveClientAs(ownerEmail);
          await drive.files.update({
            fileId:      folderId,
            requestBody: { trashed: true },
          });
          folderTrashed = true;
          console.log(`[DeleteCourse] Folder ${folderId} dipindah ke Trash (owner: ${ownerEmail})`);
        } catch(e) {
          console.warn('[DeleteCourse] Gagal trash folder Drive:', e.message);
        }
      }

      res.json({
        success: true,
        folderTrashed,
        message: folderTrashed
          ? 'Kelas dihapus dan folder Drive dipindahkan ke Trash (bisa dipulihkan 30 hari)'
          : 'Kelas dihapus. Folder Drive tidak ditemukan atau tidak bisa diakses.',
      });
    } catch(err) { handleError(res, err); }
  });

  // PATCH /api/classroom/courses/:id — edit nama, section, status
  app.patch('/api/classroom/courses/:id', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      const { name, section, courseState } = req.body;

      const updateFields = {};
      const updateMaskParts = [];

      if (name)        { updateFields.name = name;               updateMaskParts.push('name'); }
      if (section !== undefined) { updateFields.section = section; updateMaskParts.push('section'); }
      if (courseState) { updateFields.courseState = courseState;  updateMaskParts.push('courseState'); }

      if (!updateMaskParts.length) {
        return res.status(400).json({ success: false, error: 'Tidak ada field yang diupdate' });
      }

      const result = await classroom.courses.patch({
        id: req.params.id,
        updateMask: updateMaskParts.join(','),
        requestBody: updateFields,
      });

      res.json({ success: true, data: result.data });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/classroom/courses/:id/teachers — daftar guru di kelas
  app.get('/api/classroom/courses/:id/teachers', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      const admin     = getAdminClient();

      const r = await classroom.courses.teachers.list({ courseId: req.params.id });
      const teachers = r.data.teachers || [];

      const data = await Promise.all(teachers.map(async t => {
        let email = t.profile?.emailAddress || '';
        let name  = t.profile?.name?.fullName || '-';
        if (!email) {
          try {
            const u = await admin.users.get({ userKey: t.userId, projection: 'basic' });
            email = u.data.primaryEmail || '-';
            if (name === '-') name = u.data.name?.fullName || '-';
          } catch(_) { email = '-'; }
        }
        return { userId: t.userId, name, email };
      }));

      res.json({ success: true, data });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses/:id/teachers — tambah guru ke kelas
  app.post('/api/classroom/courses/:id/teachers', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      const { teacherEmail } = req.body;
      if (!teacherEmail) return res.status(400).json({ success: false, error: 'teacherEmail wajib diisi' });

      await classroom.courses.teachers.create({
        courseId: req.params.id,
        requestBody: { userId: teacherEmail.trim() }
      });
      res.json({ success: true, message: `${teacherEmail} berhasil ditambahkan sebagai guru` });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/classroom/courses/:courseId/teachers/:userId — hapus guru dari kelas
  app.delete('/api/classroom/courses/:courseId/teachers/:userId', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      await classroom.courses.teachers.delete({
        courseId: req.params.courseId,
        userId:   req.params.userId,
      });
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses/:id/import-from-ou — import siswa dari OU
  app.post('/api/classroom/courses/:id/import-from-ou', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      const admin     = getAdminClient();
      const { orgUnitPath, studentEmails } = req.body;

      if (!studentEmails || !studentEmails.length) {
        return res.status(400).json({ success: false, error: 'studentEmails wajib diisi' });
      }

      const results = { success: [], failed: [], skipped: [] };

      for (const email of studentEmails) {
        try {
          await classroom.courses.students.create({
            courseId: req.params.id,
            requestBody: { userId: email.trim() }
          });
          results.success.push(email);
        } catch(e) {
          // Error 409 = sudah terdaftar, skip saja
          if (e.errors?.[0]?.reason === 'alreadyExists' || e.code === 409) {
            results.skipped.push(email);
          } else {
            results.failed.push({ email, error: e.errors?.[0]?.message || e.message });
          }
        }
      }

      res.json({
        success: true,
        totalSuccess: results.success.length,
        totalSkipped: results.skipped.length,
        totalFailed:  results.failed.length,
        results,
      });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/classroom/courses/:id/students
  app.get('/api/classroom/courses/:id/students', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      const admin     = getAdminClient();
      let students = [], pageToken = null;
      do {
        const params = { courseId: req.params.id, pageSize: 50 };
        if (pageToken) params.pageToken = pageToken;
        const r  = await classroom.courses.students.list(params);
        students  = students.concat(r.data.students || []);
        pageToken = r.data.nextPageToken || null;
      } while (pageToken);

      const data = await Promise.all(students.map(async s => {
        let email = s.profile?.emailAddress || '';
        let name  = s.profile?.name?.fullName || '-';
        if (!email) {
          try {
            const u = await admin.users.get({ userKey: s.userId, projection: 'basic' });
            email = u.data.primaryEmail || '-';
            if (name === '-') name = u.data.name?.fullName || '-';
          } catch(_) { email = '-'; }
        }
        return { userId: s.userId, name, email };
      }));
      res.json({ success: true, data });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/classroom/courses/:courseId/students
  app.post('/api/classroom/courses/:courseId/students', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      const { studentEmail } = req.body;
      if (!studentEmail) return res.status(400).json({ success: false, error: 'studentEmail wajib diisi' });
      await classroom.courses.students.create({
        courseId: req.params.courseId,
        requestBody: { userId: studentEmail.trim() }
      });
      res.json({ success: true, message: `${studentEmail} berhasil ditambahkan` });
    } catch(err) { handleError(res, err); }
  });

  // DELETE /api/classroom/courses/:courseId/students/:userId
  app.delete('/api/classroom/courses/:courseId/students/:userId', async (req, res) => {
    try {
      const classroom = await getClassroomClient();
      await classroom.courses.students.delete({
        courseId: req.params.courseId, userId: req.params.userId,
      });
      res.json({ success: true });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/classroom/search-users?q=
  app.get('/api/classroom/search-users', async (req, res) => {
    try {
      const q = (req.query.q || '').trim();
      if (q.length < 3) return res.json({ success: true, data: [] });
      const admin     = getAdminClient();
      const firstWord = q.split(' ')[0];
      let users = [];
      try {
        const r = await admin.users.list({
          customer: 'my_customer',
          query: `name:${firstWord}* OR email:${q}*`,
          maxResults: 8, orderBy: 'givenName',
        });
        users = r.data.users || [];
      } catch(_) {
        try {
          const fb = await admin.users.list({
            customer: 'my_customer',
            query: `email:${q.split('@')[0]}*`, maxResults: 5,
          });
          users = fb.data.users || [];
        } catch(err2) {
          return res.status(500).json({ success: false, error: 'Admin SDK Error: ' + err2.message });
        }
      }
      res.json({ success: true, data: users.map(u => ({ name: u.name.fullName, email: u.primaryEmail })) });
    } catch(err) { handleError(res, err); }
  });

};