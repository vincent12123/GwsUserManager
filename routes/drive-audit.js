/**
 * routes/drive-audit.js
 * ══════════════════════
 * Drive Audit Center — Investigasi Kebocoran Data
 * Semua operasi read-only, silent (user tidak tahu)
 *
 * POST /api/drive-audit/user-info   → info user + storage
 * POST /api/drive-audit/files       → list semua file + metadata
 * POST /api/drive-audit/sharing     → deteksi sharing mencurigakan
 * POST /api/drive-audit/activity    → timeline activity + bulk detector
 * POST /api/drive-audit/trash       → file di-trash + korelasi sharing
 * POST /api/drive-audit/export      → generate XLSX + JSON report
 */

const {
  getDriveReadonlyAs,
  getAdminDirectoryAs,
  getReportsClient,
  handleError,
} = require('../helpers/auth');

const { ADMIN_EMAIL, DOMAIN } = require('../config');

// Domain yang dianggap "personal" (flag merah)
const PERSONAL_DOMAINS = [
  'gmail.com','yahoo.com','hotmail.com','outlook.com',
  'protonmail.com','icloud.com','live.com','ymail.com',
];

// Helper: ambil semua halaman dari Drive files.list
async function listAllDriveFiles(drive, params) {
  let all = [], pageToken;
  do {
    const res = await drive.files.list({ ...params, pageToken, pageSize: 1000 });
    all       = all.concat(res.data.files || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

// Helper: sleep
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = function(app) {

  // ── POST /api/drive-audit/user-info ─────────────────────────────────────
  app.post('/api/drive-audit/user-info', async (req, res) => {
    try {
      const { userEmail } = req.body;
      if (!userEmail) return res.status(400).json({ error: 'userEmail wajib diisi' });

      // Ambil info user dari Directory API — termasuk storage breakdown
      const directory = await getAdminDirectoryAs(ADMIN_EMAIL);

      // Definisikan helper dulu
      const toGB = bytes => bytes ? +(parseInt(bytes) / 1024 ** 3).toFixed(2) : 0;
      const toMB = bytes => bytes ? +(parseInt(bytes) / 1024 ** 2).toFixed(0) : 0;

      // Ambil info user dan quotaInfo secara paralel — dipisah supaya tidak saling mengganggu
      const drive  = await getDriveReadonlyAs(userEmail);
      const [userInfoRes, userQuotaRes, aboutRes] = await Promise.allSettled([
        directory.users.get({
          userKey: userEmail,
          fields:  'name,primaryEmail,orgUnitPath,lastLoginTime,suspended,isAdmin,agreedToTerms',
        }),
        directory.users.get({
          userKey: userEmail,
          fields:  'quotaInfo',
        }),
        drive.about.get({ fields: 'storageQuota' }),
      ]);

      const userInfo  = userInfoRes.status  === 'fulfilled' ? userInfoRes.value  : null;
      const quotaInfo = userQuotaRes.status === 'fulfilled'
        ? (userQuotaRes.value?.data?.quotaInfo || {})
        : {};
      const quota     = aboutRes.status     === 'fulfilled'
        ? (aboutRes.value?.data?.storageQuota || {})
        : {};

      // storageUsed dari Directory = total termasuk Photos
      const totalDirGB  = toGB(quotaInfo.storageUsed);
      const driveGB     = toGB(quota.usageInDrive);
      const trashGB     = toGB(quota.usageInDriveTrash);
      const limitGB     = toGB(quota.limit);

      const totalUsedGB = totalDirGB > 0 ? totalDirGB : toGB(quota.usage);
      const photosGB    = +(Math.max(0, totalUsedGB - driveGB).toFixed(2));
      const usedPct     = limitGB > 0 ? Math.round(totalUsedGB / limitGB * 100) : 0;
      const photosFlag  = photosGB > 1;
      const trashFlag   = parseInt(quota.usageInDriveTrash || 0) > 500 * 1024 * 1024;

      res.json({
        success: true,
        user: userInfo?.data || null,
        storage: {
          usedGB:   totalUsedGB,
          driveGB,
          trashGB,
          photosGB,
          limitGB,
          usedPct,
          trashMB:  toMB(quota.usageInDriveTrash),
          trashFlag,
          photosFlag,
          gmailGB:  +(Math.max(0, totalUsedGB - driveGB - photosGB).toFixed(2)),
        },
      });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/drive-audit/files ──────────────────────────────────────────
  app.post('/api/drive-audit/files', async (req, res) => {
    try {
      const { userEmail } = req.body;
      if (!userEmail) return res.status(400).json({ error: 'userEmail wajib diisi' });

      const drive = await getDriveReadonlyAs(userEmail);

      const files = await listAllDriveFiles(drive, {
        q:      'trashed = false',
        fields: 'nextPageToken, files(id,name,mimeType,size,quotaBytesUsed,createdTime,modifiedTime,shared,webViewLink,parents)',
        orderBy: 'quotaBytesUsed desc',
      });

      const SENSITIVE_KEYWORDS = ['data','nilai','rapor','gaji','keuangan','rahasia','siswa','guru','privat','secret','password','credential'];
      const toMB = b => b ? +(parseInt(b) / 1024 ** 2).toFixed(2) : 0;

      const mapped = files.map(f => ({
        id:           f.id,
        name:         f.name,
        mimeType:     f.mimeType,
        sizeMB:       toMB(f.size || f.quotaBytesUsed),
        createdTime:  f.createdTime,
        modifiedTime: f.modifiedTime,
        shared:       f.shared || false,
        webViewLink:  f.webViewLink,
        sensitive:    SENSITIVE_KEYWORDS.some(k => f.name.toLowerCase().includes(k)),
      }));

      res.json({
        success:      true,
        total:        mapped.length,
        totalSizeMB:  +mapped.reduce((s, f) => s + f.sizeMB, 0).toFixed(1),
        sharedCount:  mapped.filter(f => f.shared).length,
        sensitiveCount: mapped.filter(f => f.sensitive).length,
        largCount:    mapped.filter(f => f.sizeMB > 10).length,
        files:        mapped,
      });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/drive-audit/sharing ────────────────────────────────────────
  app.post('/api/drive-audit/sharing', async (req, res) => {
    try {
      const { userEmail } = req.body;
      if (!userEmail) return res.status(400).json({ error: 'userEmail wajib diisi' });

      const drive = await getDriveReadonlyAs(userEmail);

      // Ambil semua file lalu filter shared di kode
      // (shared bukan query term yang valid di Drive API v3 — output-only field)
      const allFiles = await listAllDriveFiles(drive, {
        q:      'trashed = false',
        fields: 'nextPageToken, files(id,name,mimeType,size,webViewLink,shared,permissions(id,emailAddress,role,type,displayName),createdTime,modifiedTime)',
      });

      // Hanya proses file yang memang dishare
      const files = allFiles.filter(f => f.shared === true);

      const critical = []; // ke email personal
      const warning  = []; // anyone with link / public
      const info     = []; // domain lain

      files.forEach(f => {
        (f.permissions || []).forEach(p => {
          const base = {
            fileId:      f.id,
            fileName:    f.name,
            mimeType:    f.mimeType,
            sizeMB:      f.size ? +(parseInt(f.size) / 1024 ** 2).toFixed(2) : 0,
            modifiedTime: f.modifiedTime,
            webViewLink: f.webViewLink,
            role:        p.role,
            type:        p.type,
            email:       p.emailAddress || '',
            displayName: p.displayName || '',
          };

          if (p.type === 'anyone') {
            warning.push({ ...base, category: 'anyone_link' });
          } else if (p.type === 'user' && p.emailAddress) {
            const domain = p.emailAddress.split('@')[1] || '';
            if (PERSONAL_DOMAINS.includes(domain)) {
              critical.push({ ...base, category: 'personal_email', domain });
            } else if (!p.emailAddress.endsWith('@' + DOMAIN)) {
              info.push({ ...base, category: 'other_domain', domain });
            }
          }
        });
      });

      res.json({
        success:       true,
        criticalCount: critical.length,
        warningCount:  warning.length,
        infoCount:     info.length,
        critical,
        warning,
        info,
      });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/drive-audit/activity ───────────────────────────────────────
  app.post('/api/drive-audit/activity', async (req, res) => {
    try {
      const { userEmail, startDate, endDate, events: eventFilter } = req.body;
      if (!userEmail) return res.status(400).json({ error: 'userEmail wajib diisi' });

      const reports   = await getReportsClient();
      const wantEvents = eventFilter?.length
        ? eventFilter
        : ['download','copy','move','delete','upload','change_user_access','change_document_visibility'];

      const start = startDate
        ? new Date(startDate).toISOString()
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end   = endDate ? new Date(endDate).toISOString() : new Date().toISOString();

      // Ambil semua event Drive untuk user ini dalam rentang tanggal
      let allItems = [], pageToken;
      do {
        const r = await reports.activities.list({
          userKey:         userEmail,
          applicationName: 'drive',
          startTime:       start,
          endTime:         end,
          maxResults:      1000,
          pageToken,
        });
        allItems  = allItems.concat(r.data.items || []);
        pageToken = r.data.nextPageToken;
        if (pageToken) await sleep(200);
      } while (pageToken);

      // Parse events
      const EVENT_ICON = {
        download: '📥', copy: '📋', move: '📂', delete: '🗑',
        upload: '📤', edit: '✏️',
        change_user_access: '🔗', change_document_visibility: '🔗',
        trash: '🗑', untrash: '♻️', rename: '✏️',
      };

      const activities = [];
      allItems.forEach(item => {
        const time   = item.id?.time;
        const ip     = item.ipAddress || '';
        (item.events || []).forEach(ev => {
          if (!wantEvents.includes(ev.name)) return;
          const params = {};
          (ev.parameters || []).forEach(p => { params[p.name] = p.value || p.boolValue; });
          activities.push({
            time,
            ip,
            event:    ev.name,
            icon:     EVENT_ICON[ev.name] || '📄',
            docTitle: params['doc_title'] || params['doc_id'] || '(Tanpa judul)',
            docType:  params['doc_type']  || '',
            target:   params['target_user'] || '',
            visibility: params['visibility'] || '',
          });
        });
      });

      // Sort by time desc
      activities.sort((a, b) => new Date(b.time) - new Date(a.time));

      // Bulk download detector — cari >= 5 download/copy dalam 15 menit
      const BULK_THRESHOLD = 5;
      const BULK_WINDOW    = 15 * 60 * 1000; // 15 menit
      const bulkEvents     = activities.filter(a => ['download','copy'].includes(a.event));
      const bulkAlerts     = [];

      for (let i = 0; i < bulkEvents.length; i++) {
        const t0    = new Date(bulkEvents[i].time).getTime();
        const group = bulkEvents.filter(a => {
          const t = new Date(a.time).getTime();
          return t >= t0 - BULK_WINDOW && t <= t0;
        });
        if (group.length >= BULK_THRESHOLD) {
          const key = `${Math.floor(t0 / BULK_WINDOW)}`; // deduplicate per window
          if (!bulkAlerts.find(b => b.key === key)) {
            bulkAlerts.push({
              key,
              startTime:  group[group.length - 1].time,
              endTime:    group[0].time,
              count:      group.length,
              files:      group.map(a => a.docTitle).slice(0, 10),
              ip:         group[0].ip,
            });
          }
        }
      }

      // Group by day untuk tampilan timeline
      const byDay = {};
      activities.forEach(a => {
        const day = a.time ? a.time.slice(0, 10) : 'unknown';
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(a);
      });

      res.json({
        success:      true,
        total:        activities.length,
        period:       { start, end },
        bulkAlerts,
        byDay,
        activities,
      });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/drive-audit/trash ──────────────────────────────────────────
  app.post('/api/drive-audit/trash', async (req, res) => {
    try {
      const { userEmail } = req.body;
      if (!userEmail) return res.status(400).json({ error: 'userEmail wajib diisi' });

      const drive = await getDriveReadonlyAs(userEmail);

      // File di trash milik user
      const trashFiles = await listAllDriveFiles(drive, {
        q:      'trashed = true',
        fields: 'nextPageToken, files(id,name,mimeType,size,trashedTime,shared,permissions(emailAddress,type),webViewLink)',
      });

      const toMB = b => b ? +(parseInt(b) / 1024 ** 2).toFixed(2) : 0;

      const mapped = trashFiles.map(f => {
        const hasExternalShare = (f.permissions || []).some(p => {
          if (p.type === 'anyone') return true;
          if (p.type === 'user' && p.emailAddress) {
            const domain = p.emailAddress.split('@')[1] || '';
            return PERSONAL_DOMAINS.includes(domain) || !p.emailAddress.endsWith('@' + DOMAIN);
          }
          return false;
        });
        return {
          id:          f.id,
          name:        f.name,
          mimeType:    f.mimeType,
          sizeMB:      toMB(f.size),
          trashedTime: f.trashedTime,
          wasShared:   f.shared || false,
          hasExternalShareBeforeTrash: hasExternalShare,
          webViewLink: f.webViewLink,
          flag:        hasExternalShare && f.shared, // paling mencurigakan
        };
      });

      // Sort: yang paling mencurigakan dulu
      mapped.sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0)
        || new Date(b.trashedTime) - new Date(a.trashedTime));

      res.json({
        success:    true,
        total:      mapped.length,
        flagged:    mapped.filter(f => f.flag).length,
        totalSizeMB: +mapped.reduce((s, f) => s + f.sizeMB, 0).toFixed(1),
        files:      mapped,
      });
    } catch(err) { handleError(res, err); }
  });

  // ── POST /api/drive-audit/export ─────────────────────────────────────────
  // Server fetch semua data sendiri — tidak terima payload besar dari client
  app.post('/api/drive-audit/export', async (req, res) => {
    try {
      const { userEmail, startDate, endDate } = req.body;
      if (!userEmail) return res.status(400).json({ error: 'userEmail wajib diisi' });

      const fsLib  = require('fs');
      const path   = require('path');
      const outDir = './audit_outputs';
      if (!fsLib.existsSync(outDir)) fsLib.mkdirSync(outDir, { recursive: true });

      // ── Fetch semua data di sisi server ──
      console.log(`[DriveAudit] Export dimulai untuk ${userEmail}`);

      // 1. User info + storage
      const drive     = await getDriveReadonlyAs(userEmail);
      const directory = await getAdminDirectoryAs(ADMIN_EMAIL);
      const [userInfo, aboutData] = await Promise.allSettled([
        directory.users.get({ userKey: userEmail, fields: 'name,primaryEmail,orgUnitPath,lastLoginTime,suspended,quotaInfo' }),
        drive.about.get({ fields: 'storageQuota' }),
      ]);
      const user      = userInfo.status === 'fulfilled' ? userInfo.value.data : null;
      const quota     = aboutData.status === 'fulfilled' ? aboutData.value.data.storageQuota : {};
      const toGB      = b => b ? +(parseInt(b) / 1024 ** 3).toFixed(2) : 0;
      const quotaInfo = user?.quotaInfo || {};
      const driveGB   = toGB(quota.usageInDrive);
      const trashGB   = toGB(quota.usageInDriveTrash);
      const limitGB   = toGB(quota.limit);
      // Total dari Directory API lebih akurat (termasuk Photos)
      const totalGB   = toGB(quotaInfo.storageUsed) || toGB(quota.usage);
      const photosGB  = +(Math.max(0, totalGB - driveGB).toFixed(2));
      const storage = {
        usedGB:    totalGB,
        driveGB,
        trashGB,
        photosGB,
        gmailGB:   +(Math.max(0, totalGB - driveGB - photosGB).toFixed(2)),
        limitGB,
        usedPct:   limitGB > 0 ? Math.round(totalGB / limitGB * 100) : 0,
        trashFlag: parseInt(quota.usageInDriveTrash||0) > 500 * 1024 * 1024,
        photosFlag: photosGB > 1,
      };

      // 2. File list (metadata only, max 500 untuk performa)
      let allFiles = [];
      try {
        allFiles = await listAllDriveFiles(drive, {
          q:      'trashed = false',
          fields: 'nextPageToken, files(id,name,mimeType,size,quotaBytesUsed,createdTime,modifiedTime,shared)',
          orderBy: 'quotaBytesUsed desc',
        });
      } catch(e) { console.warn('[DriveAudit] files error:', e.message); }

      const SENSITIVE_KW = ['data','nilai','rapor','gaji','keuangan','rahasia','siswa','guru','privat','secret'];
      const toMB = b => b ? +(parseInt(b) / 1024 ** 2).toFixed(2) : 0;
      const files = {
        total:          allFiles.length,
        totalSizeMB:    +allFiles.reduce((s,f) => s + toMB(f.size || f.quotaBytesUsed), 0).toFixed(1),
        sharedCount:    allFiles.filter(f => f.shared).length,
        sensitiveCount: allFiles.filter(f => SENSITIVE_KW.some(k => f.name.toLowerCase().includes(k))).length,
        top20: allFiles.slice(0, 20).map(f => ({
          name: f.name, mimeType: f.mimeType,
          sizeMB: toMB(f.size || f.quotaBytesUsed),
          modifiedTime: f.modifiedTime, shared: f.shared,
        })),
      };

      // 3. Sharing
      let sharing = { criticalCount: 0, warningCount: 0, infoCount: 0, critical: [], warning: [], info: [] };
      try {
        const allSharingFiles = await listAllDriveFiles(drive, {
          q:      'trashed = false',
          fields: 'nextPageToken, files(id,name,size,modifiedTime,shared,permissions(emailAddress,role,type))',
        });
        // Filter shared di kode — bukan di query (shared bukan query term valid di v3)
        const sharedFiles = allSharingFiles.filter(f => f.shared === true);
        sharedFiles.forEach(f => {
          (f.permissions || []).forEach(p => {
            const base = { fileName: f.name, sizeMB: toMB(f.size), modifiedTime: f.modifiedTime, role: p.role, type: p.type, email: p.emailAddress || '' };
            if (p.type === 'anyone') {
              sharing.warning.push({ ...base, category: 'anyone_link' });
            } else if (p.type === 'user' && p.emailAddress) {
              const domain = p.emailAddress.split('@')[1] || '';
              if (PERSONAL_DOMAINS.includes(domain)) sharing.critical.push({ ...base, domain, category: 'personal_email' });
              else if (!p.emailAddress.endsWith('@' + DOMAIN)) sharing.info.push({ ...base, domain, category: 'other_domain' });
            }
          });
        });
        sharing.criticalCount = sharing.critical.length;
        sharing.warningCount  = sharing.warning.length;
        sharing.infoCount     = sharing.info.length;
      } catch(e) { console.warn('[DriveAudit] sharing error:', e.message); }

      // 4. Activity (30 hari terakhir, max download/copy/share)
      let activity = { total: 0, bulkAlerts: [], activities: [] };
      try {
        const reports = await getReportsClient();
        const start   = startDate ? new Date(startDate).toISOString()
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const end     = endDate ? new Date(endDate).toISOString() : new Date().toISOString();

        let items = [], pt;
        do {
          const r = await reports.activities.list({
            userKey: userEmail, applicationName: 'drive',
            startTime: start, endTime: end, maxResults: 1000, pageToken: pt,
          });
          items = items.concat(r.data.items || []);
          pt    = r.data.nextPageToken;
          if (pt) await sleep(200);
        } while (pt);

        const EVENT_ICON = { download:'📥', copy:'📋', move:'📂', delete:'🗑', upload:'📤', edit:'✏️', change_user_access:'🔗' };
        items.forEach(item => {
          (item.events || []).forEach(ev => {
            if (!['download','copy','change_user_access','delete','upload'].includes(ev.name)) return;
            const params = {};
            (ev.parameters || []).forEach(p => { params[p.name] = p.value || p.boolValue; });
            activity.activities.push({
              time: item.id?.time, ip: item.ipAddress || '',
              event: ev.name, icon: EVENT_ICON[ev.name] || '📄',
              docTitle: params['doc_title'] || '(Tanpa judul)',
              target: params['target_user'] || '',
            });
          });
        });
        activity.total = activity.activities.length;

        // Bulk detector
        const dlEvents = activity.activities.filter(a => ['download','copy'].includes(a.event));
        for (let i = 0; i < dlEvents.length; i++) {
          const t0    = new Date(dlEvents[i].time).getTime();
          const group = dlEvents.filter(a => {
            const t = new Date(a.time).getTime(); return t >= t0 - 15*60*1000 && t <= t0;
          });
          if (group.length >= 5) {
            const key = `${Math.floor(t0 / (15*60*1000))}`;
            if (!activity.bulkAlerts.find(b => b.key === key)) {
              activity.bulkAlerts.push({ key, startTime: group[group.length-1].time, endTime: group[0].time,
                count: group.length, files: group.map(a => a.docTitle).slice(0,10), ip: group[0].ip });
            }
          }
        }
      } catch(e) { console.warn('[DriveAudit] activity error:', e.message); }

      // 5. Trash
      let trash = { total: 0, flagged: 0, totalSizeMB: 0, files: [] };
      try {
        const trashFiles = await listAllDriveFiles(drive, {
          q:      'trashed = true',
          fields: 'nextPageToken, files(id,name,size,trashedTime,shared,permissions(emailAddress,type))',
        });
        trash.files = trashFiles.map(f => {
          const hasExt = (f.permissions||[]).some(p =>
            p.type === 'anyone' || (p.type === 'user' && p.emailAddress &&
              (PERSONAL_DOMAINS.includes(p.emailAddress.split('@')[1]) || !p.emailAddress.endsWith('@'+DOMAIN)))
          );
          return { name: f.name, sizeMB: toMB(f.size), trashedTime: f.trashedTime, wasShared: f.shared, flag: hasExt && f.shared };
        });
        trash.total      = trash.files.length;
        trash.flagged    = trash.files.filter(f => f.flag).length;
        trash.totalSizeMB = +trash.files.reduce((s,f) => s + f.sizeMB, 0).toFixed(1);
      } catch(e) { console.warn('[DriveAudit] trash error:', e.message); }

      // ── Hitung risk level ──
      let riskScore = 0;
      if (sharing.criticalCount > 0)       riskScore += 40;
      if (sharing.warningCount  > 0)       riskScore += 20;
      if (activity.bulkAlerts?.length > 0) riskScore += 30;
      if (trash.flagged > 0)               riskScore += 20;
      if (storage.trashFlag)               riskScore += 10;
      if (storage.photosFlag)              riskScore += 15; // Photos besar = perlu investigasi
      const riskLevel = riskScore >= 60 ? '🔴 TINGGI' : riskScore >= 30 ? '🟡 SEDANG' : '🟢 RENDAH';

      const recs = buildRecommendations(riskScore, sharing, activity, trash, storage);

      // ── Simpan JSON ──
      const ts        = Date.now();
      const safeEmail = userEmail.replace(/[^a-zA-Z0-9]/g, '_');
      const dateStr   = new Date().toISOString().slice(0, 10);

      const report = {
        meta: { auditDate: new Date().toISOString(), auditBy: ADMIN_EMAIL, targetUser: userEmail, riskLevel, riskScore },
        summary: {
          totalFiles: files.total, totalSizeMB: files.totalSizeMB,
          sharedFiles: files.sharedCount, sensitiveFiles: files.sensitiveCount,
          sharingCritical: sharing.criticalCount, sharingWarning: sharing.warningCount,
          totalActivityEvents: activity.total, bulkDownloadAlerts: activity.bulkAlerts.length,
          trashTotal: trash.total, trashFlagged: trash.flagged,
          storageGB: storage.usedGB, trashGB: storage.trashGB,
        },
        userInfo: user, storage,
        top20Files: files.top20,
        sharingCritical: sharing.critical,
        sharingWarning:  sharing.warning,
        bulkAlerts:      activity.bulkAlerts,
        recentActivity:  activity.activities.slice(0, 100),
        trashFlagged:    trash.files.filter(f => f.flag),
        recommendations: recs,
      };

      const jsonPath = path.join(outDir, `audit_${safeEmail}_${dateStr}_${ts}.json`);
      fsLib.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

      // ── Buat XLSX ──
      let xlsxPath = null;
      try {
        const XLSX = require('xlsx');
        const wb   = XLSX.utils.book_new();

        const summaryData = [
          ['LAPORAN AUDIT KEAMANAN DATA GOOGLE DRIVE'],
          [''],
          ['Tanggal Audit',   new Date().toLocaleString('id-ID')],
          ['Target',          userEmail],
          ['Diaudit Oleh',    ADMIN_EMAIL],
          ['Tingkat Risiko',  riskLevel],
          [''],
          ['RINGKASAN TEMUAN'],
          ['Total File',                      report.summary.totalFiles],
          ['Total Ukuran (MB)',               report.summary.totalSizeMB],
          ['File Dishare',                    report.summary.sharedFiles],
          ['File Kata Kunci Sensitif',        report.summary.sensitiveFiles],
          ['Sharing ke Email Personal 🚨',    report.summary.sharingCritical],
          ['Sharing Publik/Anyone Link ⚠️',  report.summary.sharingWarning],
          ['Total Activity Events',           report.summary.totalActivityEvents],
          ['Bulk Download Alert',             report.summary.bulkDownloadAlerts],
          ['File di Trash',                   report.summary.trashTotal],
          ['File Trash Pernah Dishare',       report.summary.trashFlagged],
          ['Storage Terpakai (GB)',           report.summary.storageGB],
          [''],
          ['REKOMENDASI'],
          ...recs.map(r => ['•', r]),
        ];
        const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
        ws1['!cols'] = [{ wch: 35 }, { wch: 55 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

        if (sharing.critical.length) {
          const rows = [['File','Email','Domain','Role','Ukuran (MB)','Terakhir Dimodifikasi']];
          sharing.critical.forEach(s => rows.push([s.fileName, s.email, s.domain, s.role, s.sizeMB, s.modifiedTime]));
          const ws = XLSX.utils.aoa_to_sheet(rows);
          ws['!cols'] = [{wch:40},{wch:35},{wch:15},{wch:10},{wch:12},{wch:22}];
          XLSX.utils.book_append_sheet(wb, ws, '🚨 Sharing Kritis');
        }
        if (sharing.warning.length) {
          const rows = [['File','Role','Tipe','Ukuran (MB)']];
          sharing.warning.forEach(s => rows.push([s.fileName, s.role, s.type, s.sizeMB]));
          const ws = XLSX.utils.aoa_to_sheet(rows);
          ws['!cols'] = [{wch:40},{wch:10},{wch:12},{wch:12}];
          XLSX.utils.book_append_sheet(wb, ws, '⚠️ Sharing Publik');
        }
        if (activity.bulkAlerts.length) {
          const rows = [['Waktu Mulai','Waktu Selesai','Jumlah File','IP','File']];
          activity.bulkAlerts.forEach(b => rows.push([b.startTime, b.endTime, b.count, b.ip, (b.files||[]).join(', ')]));
          const ws = XLSX.utils.aoa_to_sheet(rows);
          ws['!cols'] = [{wch:22},{wch:22},{wch:12},{wch:18},{wch:80}];
          XLSX.utils.book_append_sheet(wb, ws, '📥 Bulk Download');
        }
        if (activity.activities.length) {
          const rows = [['Waktu','Event','Nama File','Dishare ke','IP']];
          activity.activities.slice(0,500).forEach(a => rows.push([a.time, a.event, a.docTitle, a.target, a.ip]));
          const ws = XLSX.utils.aoa_to_sheet(rows);
          ws['!cols'] = [{wch:22},{wch:20},{wch:45},{wch:35},{wch:18}];
          XLSX.utils.book_append_sheet(wb, ws, '📋 Activity Log');
        }
        if (trash.files.filter(f=>f.flag).length) {
          const rows = [['File','Ukuran (MB)','Waktu Dihapus','Pernah Dishare']];
          trash.files.filter(f=>f.flag).forEach(t => rows.push([t.name, t.sizeMB, t.trashedTime, t.wasShared ? 'Ya' : 'Tidak']));
          const ws = XLSX.utils.aoa_to_sheet(rows);
          ws['!cols'] = [{wch:40},{wch:12},{wch:22},{wch:15}];
          XLSX.utils.book_append_sheet(wb, ws, '🗑 Trash Flagged');
        }

        xlsxPath = path.join(outDir, `audit_${safeEmail}_${dateStr}_${ts}.xlsx`);
        XLSX.writeFile(wb, xlsxPath);
      } catch(xlsxErr) {
        console.warn('[DriveAudit] XLSX error:', xlsxErr.message);
      }

      const host = `${req.protocol}://${req.get('host')}`;
      res.json({
        success:  true,
        riskLevel, riskScore,
        summary:  report.summary,
        recommendations: recs,
        downloads: {
          json: { filename: path.basename(jsonPath), url: `${host}/api/drive-audit/download/${path.basename(jsonPath)}` },
          xlsx: xlsxPath ? { filename: path.basename(xlsxPath), url: `${host}/api/drive-audit/download/${path.basename(xlsxPath)}` } : null,
        },
      });
    } catch(err) { handleError(res, err); }
  });

  // ── Serve audit output files ──────────────────────────────────────────────
  const express = require('express');
  const path    = require('path');
  const outDir  = path.join(process.cwd(), 'audit_outputs');
  app.use('/api/drive-audit/download', express.static(outDir));

};

// ── Build rekomendasi dari temuan ─────────────────────────────────────────────
function buildRecommendations(score, sharing, activity, trash, storage) {
  const recs = [];
  if (sharing?.criticalCount > 0)
    recs.push(`Segera revoke ${sharing.criticalCount} sharing ke email personal dari akun target`);
  if (sharing?.warningCount > 0)
    recs.push(`Tinjau ${sharing.warningCount} file yang dapat diakses siapa saja dengan link`);
  if (activity?.bulkAlerts?.length > 0)
    recs.push(`Investigasi ${activity.bulkAlerts.length} kejadian bulk download — kemungkinan data exfiltration`);
  if (trash?.flagged > 0)
    recs.push(`Periksa ${trash.flagged} file di Trash yang pernah dishare ke luar sebelum dihapus`);
  if (storage?.trashFlag)
    recs.push(`Trash penuh (${storage.trashGB} GB) — kemungkinan ada file bukti yang disembunyikan`);
  if (storage?.photosFlag)
    recs.push(`Google Photos ${storage.photosGB} GB — tanyakan keperluan penyimpanan foto sebesar ini di akun sekolah`);
  if (score >= 60)
    recs.push('Segera koordinasi dengan HR/Pimpinan Yayasan sebelum mengambil tindakan');
  if (score >= 60)
    recs.push('Pertimbangkan suspend akun sementara sambil investigasi berlanjut');
  recs.push('Simpan laporan ini di lokasi aman — hanya Super Admin yang bisa mengakses');
  recs.push('Dokumentasikan setiap langkah audit sebagai chain of custody');
  return recs;
}