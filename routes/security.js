// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: SECURITY — Device Audit, Remote Wipe, Login Activity + Geolocation
// ═══════════════════════════════════════════════════════════════════════════════

const { getMobileDeviceClient, getReportsClient, getReportsAndDirectoryClients, handleError } = require('../helpers/auth');
const { auditLog } = require('../db/audit');
const axios  = require('axios');

// ── Konfigurasi Region Sekolah ────────────────────────────────────────────────
// Sesuaikan dengan lokasi sekolah Anda
const SCHOOL_REGION = {
  country:    'Indonesia',
  countryCode: 'ID',
  region:     'Kalimantan Barat',  // provinsi
  city:       'Sintang',           // kota (opsional, untuk info saja)
};

// ISP yang dianggap mencurigakan (VPN/Cloud/Proxy)
const SUSPICIOUS_ISP = ['google', 'amazon', 'digitalocean', 'cloudflare', 'microsoft azure',
  'linode', 'vultr', 'ovh', 'hetzner', 'mullvad', 'nordvpn', 'expressvpn'];

// Cache IP geolocation supaya tidak hit API berkali-kali
const ipCache = new Map();

async function getIPLocation(ip) {
  if (!ip || ip === '-' || ip.startsWith('192.168') || ip.startsWith('10.') || ip.startsWith('127.')) {
    return { country: 'Local/Private', countryCode: 'LOCAL', region: '-', city: '-', isp: '-', riskLevel: 'local' };
  }

  // Cek cache dulu
  if (ipCache.has(ip)) return ipCache.get(ip);

  try {
    const res  = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,query`, { timeout: 3000 });
    const d    = res.data;

    if (d.status !== 'success') {
      return { country: '-', countryCode: '-', region: '-', city: '-', isp: '-', riskLevel: 'unknown' };
    }

    // Tentukan risk level
    const ispLower  = (d.isp || '').toLowerCase();
    const isVPN     = SUSPICIOUS_ISP.some(s => ispLower.includes(s));
    const isIndonesia = d.countryCode === 'ID';
    const isKalbar    = (d.regionName || '').toLowerCase().includes('kalimantan barat') ||
                        (d.regionName || '').toLowerCase().includes('west kalimantan');

    let riskLevel;
    if (isVPN)                   riskLevel = 'vpn';
    else if (!isIndonesia)       riskLevel = 'overseas';
    else if (!isKalbar)          riskLevel = 'outside_region';
    else                         riskLevel = 'safe';

    const location = {
      country:     d.country,
      countryCode: d.countryCode,
      region:      d.regionName,
      city:        d.city,
      isp:         d.isp,
      org:         d.org,
      riskLevel,
    };

    // Cache 30 menit
    ipCache.set(ip, location);
    setTimeout(() => ipCache.delete(ip), 30 * 60 * 1000);

    return location;
  } catch(e) {
    console.warn('[GeoIP] Gagal lookup IP:', ip, e.message);
    return { country: '-', countryCode: '-', region: '-', city: '-', isp: '-', riskLevel: 'unknown' };
  }
}

// GET /api/security/geoip/:ip — lookup single IP (untuk frontend)
function registerGeoRoutes(app) {
  app.get('/api/security/geoip/:ip', async (req, res) => {
    try {
      const location = await getIPLocation(req.params.ip);
      res.json({ success: true, data: location });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/security/region-config — baca konfigurasi region sekolah
  app.get('/api/security/region-config', (req, res) => {
    res.json({ success: true, data: SCHOOL_REGION });
  });
}

module.exports = function(app) {

  // Register geo routes
  registerGeoRoutes(app);

  // ─────────────────────────────────────────────────────────────────────────────
  // DEVICE AUDIT
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/security/devices — list semua perangkat mobile
  app.get('/api/security/devices', async (req, res) => {
    try {
      const admin    = await getMobileDeviceClient();
      const response = await admin.mobiledevices.list({
        customerId: 'my_customer',
        orderBy:    'lastSync',
        sortOrder:  'DESCENDING',
        projection: 'FULL',
        maxResults: 100,
      });

      const devices = (response.data.mobiledevices || []).map(d => {
        const lastSync  = d.lastSync ? new Date(d.lastSync) : null;
        const daysSince = lastSync ? Math.floor((Date.now() - lastSync) / 86400000) : null;
        const status    = !lastSync ? 'unknown'
          : daysSince <= 7  ? 'synced'
          : daysSince <= 30 ? 'stale'
          : 'inactive';

        return {
          resourceId:    d.resourceId,
          deviceId:      d.deviceId,
          name:          d.name?.join(', ') || '-',
          email:         d.email?.join(', ') || '-',
          model:         d.model           || '-',
          os:            d.os              || '-',
          type:          d.type            || '-',
          status:        d.status          || '-',
          lastSync:      d.lastSync        || null,
          daysSince,
          syncStatus:    status,
          managed:       d.managedAccountIsOnOwnerProfile ?? null,
          deviceCompromised: d.deviceCompromised || 'false',
        };
      });

      res.json({ success: true, data: devices, total: devices.length });
    } catch(err) { handleError(res, err); }
  });

  // POST /api/security/devices/wipe — Remote Wipe (account_wipe saja, bukan full wipe)
  app.post('/api/security/devices/wipe', async (req, res) => {
    try {
      const { resourceId, deviceName, userEmail, wipeType = 'account_wipe' } = req.body;
      if (!resourceId) return res.status(400).json({ success: false, error: 'resourceId wajib diisi' });

      // Nilai valid: admin_account_wipe (hapus akun sekolah saja) atau admin_remote_wipe (full factory reset)
      const allowedActions = ['admin_account_wipe', 'admin_remote_wipe'];
      if (!allowedActions.includes(wipeType)) {
        return res.status(400).json({ success: false, error: 'wipeType tidak valid' });
      }

      const admin = await getMobileDeviceClient();
      await admin.mobiledevices.action({
        customerId:  'my_customer',
        resourceId,
        requestBody: { action: wipeType },
      });

      auditLog(
        wipeType === 'admin_account_wipe' ? 'Remote Wipe (Account)' : 'Remote Wipe (Full Factory Reset)',
        userEmail || resourceId,
        `Perangkat: ${deviceName || resourceId} | Action: ${wipeType}`,
        'success'
      );

      res.json({
        success: true,
        message: wipeType === 'admin_account_wipe'
          ? 'Instruksi Account Wipe berhasil dikirim. Akun sekolah akan dihapus dari perangkat.'
          : 'Instruksi Full Wipe berhasil dikirim. Perangkat akan direset ke setelan pabrik.',
      });
    } catch(err) {
      auditLog('Remote Wipe', req.body.userEmail || '-', 'Gagal: ' + (err.message || ''), 'error');
      handleError(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // LOGIN ACTIVITY ALERT
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/security/login-activity — ambil aktivitas login N jam terakhir
  app.get('/api/security/login-activity', async (req, res) => {
    try {
      const hours    = parseInt(req.query.hours || '24');
      const maxHours = Math.min(hours, 168);
      const withGeo  = req.query.geo !== 'false'; // default: sertakan geo
      const reports  = await getReportsClient();

      const startTime = new Date(Date.now() - maxHours * 3600000).toISOString();
      const response  = await reports.activities.list({
        userKey:         'all',
        applicationName: 'login',
        startTime,
        maxResults:      200,
      });

      const activities = response.data.items || [];

      // Kumpulkan unique IPs untuk batch lookup
      const uniqueIPs = [...new Set(activities.map(a => a.ipAddress).filter(Boolean))];

      // Lookup geolocation untuk semua unique IP (parallel, max 10 sekaligus)
      const geoMap = {};
      if (withGeo) {
        const chunks = [];
        for (let i = 0; i < uniqueIPs.length; i += 10) chunks.push(uniqueIPs.slice(i, i + 10));
        for (const chunk of chunks) {
          const results = await Promise.all(chunk.map(ip => getIPLocation(ip)));
          chunk.forEach((ip, i) => { geoMap[ip] = results[i]; });
        }
      }

      const analyzed = activities.map(a => {
        const events   = a.events || [];
        const loginEvt = events.find(e => ['login_success','login_failure','login_challenge'].includes(e.name));
        const params   = {};
        (loginEvt?.parameters || []).forEach(p => { params[p.name] = p.value || p.boolValue || p.intValue; });

        const time    = new Date(a.id?.time);
        const hour    = time.getHours();
        const oddHour = hour >= 22 || hour <= 5;
        const geo     = geoMap[a.ipAddress] || null;

        const isFailed   = loginEvt?.name === 'login_failure';
        const isOverseas = geo?.riskLevel === 'overseas';
        const isVPN      = geo?.riskLevel === 'vpn';
        const isOutRegion = geo?.riskLevel === 'outside_region';

        const suspicionReasons = [
          oddHour     ? `Jam tidak wajar (${hour}:00)` : null,
          isFailed    ? 'Login gagal'                  : null,
          isOverseas  ? `Luar negeri (${geo.country})` : null,
          isVPN       ? `VPN/Proxy (${geo.isp})`       : null,
          isOutRegion ? `Luar Kalimantan Barat (${geo.region})` : null,
        ].filter(Boolean);

        return {
          time:             a.id?.time,
          user:             a.actor?.email || '-',
          ipAddress:        a.ipAddress    || '-',
          eventName:        loginEvt?.name || events[0]?.name || '-',
          loginType:        params.login_type || '-',
          geo,
          isSuspicious:     suspicionReasons.length > 0,
          suspicionReasons,
          riskLevel:        isOverseas || isVPN ? 'high'
                          : isOutRegion || isFailed ? 'medium'
                          : oddHour ? 'low' : 'safe',
        };
      });

      const summary = {
        total:          analyzed.length,
        loginSuccess:   analyzed.filter(a => a.eventName === 'login_success').length,
        loginFailed:    analyzed.filter(a => a.eventName === 'login_failure').length,
        suspicious:     analyzed.filter(a => a.isSuspicious).length,
        overseas:       analyzed.filter(a => a.geo?.riskLevel === 'overseas').length,
        vpn:            analyzed.filter(a => a.geo?.riskLevel === 'vpn').length,
        outsideRegion:  analyzed.filter(a => a.geo?.riskLevel === 'outside_region').length,
        uniqueUsers:    [...new Set(analyzed.map(a => a.user))].length,
        uniqueIPs:      [...new Set(analyzed.map(a => a.ipAddress))].length,
        hoursScanned:   maxHours,
      };

      res.json({ success: true, summary, data: analyzed });
    } catch(err) { handleError(res, err); }
  });

  // GET /api/security/login-activity/suspicious — hanya yang mencurigakan
  app.get('/api/security/login-activity/suspicious', async (req, res) => {
    try {
      const reports   = await getReportsClient();
      const startTime = new Date(Date.now() - 24 * 3600000).toISOString();

      const response = await reports.activities.list({
        userKey:         'all',
        applicationName: 'login',
        startTime,
        maxResults:      500,
      });

      const activities = response.data.items || [];

      // Lookup geo untuk semua IP dulu
      const uniqueIPs = [...new Set(activities.map(a => a.ipAddress).filter(Boolean))];
      const geoMap    = {};
      const chunks    = [];
      for (let i = 0; i < uniqueIPs.length; i += 10) chunks.push(uniqueIPs.slice(i, i + 10));
      for (const chunk of chunks) {
        const results = await Promise.all(chunk.map(ip => getIPLocation(ip)));
        chunk.forEach((ip, i) => { geoMap[ip] = results[i]; });
      }

      const suspicious = [];

      activities.forEach(a => {
        const events   = a.events || [];
        const time     = new Date(a.id?.time);
        const hour     = time.getHours();
        const oddHour  = hour >= 22 || hour <= 5;
        const isFailed = events.some(e => e.name === 'login_failure');
        const geo      = geoMap[a.ipAddress] || null;
        const isOverseas    = geo?.riskLevel === 'overseas';
        const isVPN         = geo?.riskLevel === 'vpn';
        const isOutRegion   = geo?.riskLevel === 'outside_region';

        const reasons = [
          oddHour     ? `Login jam ${hour}:00 (tidak wajar)`       : null,
          isFailed    ? 'Login gagal'                               : null,
          isOverseas  ? `Luar negeri: ${geo.country}`              : null,
          isVPN       ? `VPN/Proxy terdeteksi: ${geo.isp}`         : null,
          isOutRegion ? `Luar Kalimantan Barat: ${geo.region}`     : null,
        ].filter(Boolean);

        if (reasons.length > 0) {
          suspicious.push({
            time:       a.id?.time,
            user:       a.actor?.email || '-',
            ipAddress:  a.ipAddress    || '-',
            events:     events.map(e => e.name),
            geo,
            reasons,
            riskLevel:  isOverseas || isVPN ? 'high' : isOutRegion || isFailed ? 'medium' : 'low',
          });
        }
      });

      // Sort by risk: high dulu
      suspicious.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.riskLevel] ?? 3) - (order[b.riskLevel] ?? 3);
      });

      res.json({ success: true, data: suspicious, total: suspicious.length });
    } catch(err) { handleError(res, err); }
  });

  // ── helper: fetch semua halaman activities ───────────────────────────────────
  async function listAllActivities(applicationName, query = {}) {
    const reports = await getReportsClient();
    let items = [], pageToken;
    do {
      const r = await reports.activities.list({
        userKey: 'all', applicationName, maxResults: 1000, pageToken, ...query,
      });
      items = items.concat(r.data.items || []);
      pageToken = r.data.nextPageToken;
    } while (pageToken);
    return items;
  }

  // ── helper: dapatkan tanggal laporan yang valid (Reports API delay 2-3 hari) ─
  function getSafeReportDate(offsetDays = 3) {
    // Gunakan UTC supaya tidak kena masalah timezone
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - offsetDays);
    return d.toISOString().split('T')[0]; // format YYYY-MM-DD
  }

  // ── GET /api/security/storage ────────────────────────────────────────────────
  app.get('/api/security/storage', async (req, res) => {
    try {
      const { reports: admin, directory } = await getReportsAndDirectoryClients();

      // Coba tanggal mundur dari 3 hari, fallback ke 4 dan 5 kalau belum tersedia
      let dateStr = getSafeReportDate(3);

      let users = [], pageToken;
      do {
        const r = await directory.users.list({
          customer: 'my_customer', maxResults: 500,
          fields: 'nextPageToken,users(primaryEmail,name)', pageToken,
        });
        users = users.concat(r.data.users || []);
        pageToken = r.data.nextPageToken;
      } while (pageToken);

      // Coba beberapa tanggal mundur kalau data belum tersedia
      let validDate = null;
      for (const offset of [3, 4, 5, 6, 7]) {
        const tryDate = getSafeReportDate(offset);
        try {
          const probe = await admin.userUsageReport.get({
            userKey: users[0]?.primaryEmail || 'all',
            date: tryDate,
            parameters: 'accounts:drive_used_quota_in_mb',
          });
          const reports = probe.data.usageReports || [];
          console.log(`[Storage] Probe ${tryDate}: ${reports.length} reports, params:`,
            JSON.stringify(reports[0]?.parameters?.slice(0, 3)));
          if (reports.length) { validDate = tryDate; break; }
        } catch(e) {
          console.warn(`[Storage] Probe ${tryDate} error:`, e.message);
          // Hanya break kalau bukan error "data belum tersedia"
          if (!e.message?.includes('not yet available') && !e.message?.includes('not available')) break;
        }
      }
      dateStr = validDate || getSafeReportDate(4);
      console.log(`[Storage] Menggunakan tanggal: ${dateStr}, validDate: ${validDate}`);

      const BATCH = 20, results = [];
      for (let i = 0; i < users.length; i += BATCH) {
        const chunk   = users.slice(i, i + BATCH);
        const fetched = await Promise.allSettled(chunk.map(u =>
          admin.userUsageReport.get({
            userKey: u.primaryEmail, date: dateStr,
            parameters: [
              'accounts:drive_used_quota_in_mb',
              'accounts:gmail_used_quota_in_mb',
              'accounts:gplus_photos_used_quota_in_mb',
              'accounts:used_quota_in_mb',
              'accounts:total_quota_in_mb',
            ].join(','),
          })
        ));
        // Delay antar batch supaya tidak kena rate limit
        if (i + BATCH < users.length) await new Promise(r => setTimeout(r, 500));

        for (let j = 0; j < chunk.length; j++) {
          if (fetched[j].status !== 'fulfilled') {
            console.warn(`[Storage] Gagal user ${chunk[j].primaryEmail}:`, fetched[j].reason?.message);
            continue;
          }
          const report = fetched[j].value.data.usageReports?.[0];
          if (!report) {
            console.warn(`[Storage] Tidak ada report untuk ${chunk[j].primaryEmail}`);
            continue;
          }
          if (i === 0 && j === 0) {
            console.log(`[Storage] Sample params user ${chunk[j].primaryEmail}:`,
              JSON.stringify(report.parameters));
          }
          const get = n => {
            const p = report.parameters?.find(x => x.name === n);
            const val = p?.intValue ?? p?.msgValue?.[0]?.intValue ?? '0';
            return parseInt(val, 10) || 0;
          };
          const driveMB  = get('accounts:drive_used_quota_in_mb');
          const gmailMB  = get('accounts:gmail_used_quota_in_mb');
          const photosMB = get('accounts:gplus_photos_used_quota_in_mb');
          const usedMB   = get('accounts:used_quota_in_mb') || driveMB + gmailMB + photosMB;
          const totalMB  = get('accounts:total_quota_in_mb') || 15360;
          results.push({
            email:    chunk[j].primaryEmail,
            name:     chunk[j].name?.fullName || chunk[j].primaryEmail.split('@')[0],
            driveGB:  +(driveMB  / 1024).toFixed(2),
            gmailGB:  +(gmailMB  / 1024).toFixed(2),
            photosGB: +(photosMB / 1024).toFixed(2),
            totalGB:  +(usedMB   / 1024).toFixed(2),
            quotaGB:  +(totalMB  / 1024).toFixed(0),
            pct:      Math.min(100, Math.round(usedMB / totalMB * 100)),
          });
        }
      }
      console.log(`[Storage] Total results: ${results.length} dari ${users.length} users`);
      results.sort((a, b) => b.totalGB - a.totalGB);
      const critical = results.filter(x => x.pct >= 90).length;
      const warning  = results.filter(x => x.pct >= 70 && x.pct < 90).length;
      const safe     = results.filter(x => x.pct < 70).length;
      const totalGB  = +results.reduce((s, x) => s + x.totalGB, 0).toFixed(1);
      res.json({ date: dateStr, summary: { critical, warning, safe, totalGB }, users: results });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/security/resource-usage ────────────────────────────────────────
  app.get('/api/security/resource-usage', async (req, res) => {
    try {
      const { reports: admin, directory } = await getReportsAndDirectoryClients();

      // Auto-cari tanggal yang datanya sudah tersedia (mundur dari 3 hari)
      let dateStr;
      for (const offset of [3, 4, 5, 6, 7]) {
        const tryDate = getSafeReportDate(offset);
        try {
          const probe = await admin.customerUsageReports.get({
            date: tryDate,
            parameters: 'accounts:num_users',
          });
          if (probe.data.usageReports?.length) { dateStr = tryDate; break; }
        } catch(e) {
          if (!e.message?.includes('not yet available')) { dateStr = getSafeReportDate(3); break; }
        }
      }
      if (!dateStr) dateStr = getSafeReportDate(3);

      const domainRes = await admin.customerUsageReports.get({
        date: dateStr,
        parameters: [
          'accounts:num_users',
          'drive:num_items_created',
          'gmail:num_emails_exchanged',
        ].join(','),
      });
      const domainParams = domainRes.data.usageReports?.[0]?.parameters || [];
      const dget = n => parseInt(domainParams.find(x => x.name === n)?.intValue || 0, 10);

      let users = [], pt;
      do {
        const r = await directory.users.list({
          customer: 'my_customer', maxResults: 500,
          fields: 'nextPageToken,users(primaryEmail,name)', pageToken: pt,
        });
        users = users.concat(r.data.users || []);
        pt = r.data.nextPageToken;
      } while (pt);

      const BATCH = 20, perUser = [];
      for (let i = 0; i < users.length; i += BATCH) {
        const chunk   = users.slice(i, i + BATCH);
        const fetched = await Promise.allSettled(chunk.map(u =>
          admin.userUsageReport.get({
            userKey: u.primaryEmail, date: dateStr,
            parameters: [
              'drive:num_items_created',
              'drive:num_items_edited',
              'gmail:num_emails_sent',
            ].join(','),
          })
        ));
        for (let j = 0; j < chunk.length; j++) {
          if (fetched[j].status !== 'fulfilled') continue;
          const report = fetched[j].value.data.usageReports?.[0];
          if (!report) continue;
          const get = n => parseInt(report.parameters?.find(x => x.name === n)?.intValue || 0, 10);
          const driveAksi = get('drive:num_items_created') + get('drive:num_items_edited');
          const emailSent = get('gmail:num_emails_sent');
          if (driveAksi + emailSent === 0) continue;
          perUser.push({
            email: chunk[j].primaryEmail,
            name:  chunk[j].name?.fullName || chunk[j].primaryEmail.split('@')[0],
            driveAksi, emailSent,
          });
        }
      }
      res.json({
        date: dateStr,
        domain: {
          activeUsers:    dget('accounts:num_users'),
          driveItems:     dget('drive:num_items_created'),
          emailExchanged: dget('gmail:num_emails_exchanged'),
        },
        topDrive: [...perUser].sort((a,b) => b.driveAksi - a.driveAksi).slice(0, 10),
        topEmail: [...perUser].sort((a,b) => b.emailSent - a.emailSent).slice(0, 10),
      });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/security/sharing-alerts ────────────────────────────────────────
  // Menggunakan userUsageReport dengan parameter drive visibility
  // (bukan audit activity — audit pakai event type bukan eventName)
  app.get('/api/security/sharing-alerts', async (req, res) => {
    try {
      const { reports: admin, directory } = await getReportsAndDirectoryClients();

      // Cari tanggal valid
      let dateStr;
      for (const offset of [3, 4, 5, 6, 7]) {
        const tryDate = getSafeReportDate(offset);
        try {
          const probe = await admin.userUsageReport.get({
            userKey: 'all', date: tryDate,
            parameters: 'drive:num_owned_items_with_visibility_shared_externally_added',
            maxResults: 1,
          });
          if (probe.data.usageReports?.length) { dateStr = tryDate; break; }
        } catch(e) {
          if (!e.message?.includes('not yet available') && !e.message?.includes('not available')) break;
        }
      }
      if (!dateStr) dateStr = getSafeReportDate(4);

      // Ambil semua user
      let users = [], pageToken;
      do {
        const r = await directory.users.list({
          customer: 'my_customer', maxResults: 500,
          fields: 'nextPageToken,users(primaryEmail,name)', pageToken,
        });
        users = users.concat(r.data.users || []);
        pageToken = r.data.nextPageToken;
      } while (pageToken);

      // Fetch usage report per batch
      const BATCH = 20, sharers = [];
      for (let i = 0; i < users.length; i += BATCH) {
        const chunk   = users.slice(i, i + BATCH);
        const fetched = await Promise.allSettled(chunk.map(u =>
          admin.userUsageReport.get({
            userKey: u.primaryEmail, date: dateStr,
            parameters: [
              'drive:num_owned_items_with_visibility_shared_externally_added',
              'drive:num_owned_items_with_visibility_anyone_with_link_added',
              'drive:num_owned_items_with_visibility_public_added',
            ].join(','),
          })
        ));
        if (i + BATCH < users.length) await new Promise(r => setTimeout(r, 500));

        for (let j = 0; j < chunk.length; j++) {
          if (fetched[j].status !== 'fulfilled') continue;
          const report = fetched[j].value.data.usageReports?.[0];
          if (!report) continue;

          const get = n => {
            const p = report.parameters?.find(x => x.name === n);
            return parseInt(p?.intValue ?? '0', 10) || 0;
          };

          const sharedExt    = get('drive:num_owned_items_with_visibility_shared_externally_added');
          const anyoneLink   = get('drive:num_owned_items_with_visibility_anyone_with_link_added');
          const publicItems  = get('drive:num_owned_items_with_visibility_public_added');
          const totalShared  = sharedExt + anyoneLink + publicItems;

          if (totalShared === 0) continue;

          sharers.push({
            email:       chunk[j].primaryEmail,
            name:        chunk[j].name?.fullName || chunk[j].primaryEmail.split('@')[0],
            sharedExt,
            anyoneLink,
            publicItems,
            totalShared,
          });
        }
      }

      sharers.sort((a, b) => b.totalShared - a.totalShared);
      res.json({ date: dateStr, total: sharers.length, alerts: sharers });
    } catch(err) { handleError(res, err); }
  });

  // ── GET /api/security/drive-activity ────────────────────────────────────────
  app.get('/api/security/drive-activity', async (req, res) => {
    try {
      const admin = await getReportsClient();
      const { user = 'all', event, date, limit = 100 } = req.query;
      const query = {
        userKey:    user === 'all' ? 'all' : user,
        maxResults: Math.min(parseInt(limit, 10), 1000),
      };
      if (date) {
        const s = new Date(date); s.setHours(0,0,0,0);
        const e = new Date(date); e.setHours(23,59,59,999);
        query.startTime = s.toISOString(); query.endTime = e.toISOString();
      }
      if (event && event !== 'all') query.eventName = event;

      const r2    = await admin.activities.list({ applicationName: 'drive', ...query });
      const items = r2.data.items || [];
      const categoryMap = {
        // Access events (type=access)
        add_to_folder   : 'Ditambah ke folder',
        create          : 'Dibuat',
        delete          : 'Dihapus',
        download        : 'Diunduh',
        edit            : 'Diedit',
        move            : 'Dipindah',
        preview         : 'Dilihat preview',
        print           : 'Dicetak',
        rename          : 'Diganti nama',
        trash           : 'Dibuang ke trash',
        untrash         : 'Dipulihkan dari trash',
        upload          : 'Diupload',
        view            : 'Dilihat',
        copy            : 'Disalin',
        // ACL events (type=acl_change) — nama spesifik
        change_user_access          : 'Sharing diubah',
        change_document_visibility  : 'Visibilitas diubah',
        change_acl_editors          : 'Editor diubah',
      };
      const activities = [];
      for (const item of items) {
        const actor = item.actor?.email || 'system';
        for (const ev of (item.events || [])) {
          const params = {};
          (ev.parameters || []).forEach(p => { params[p.name] = p.value || p.boolValue; });
          // High risk: delete atau acl_change type
          const isHighRisk = ev.name === 'delete' || ev.type === 'acl_change';
          activities.push({
            time:     item.id?.time,
            actor,
            event:    ev.name,
            type:     ev.type,
            category: categoryMap[ev.name] || ev.name,
            risk:     isHighRisk ? 'high' : 'normal',
            docTitle: params['doc_title'] || '(Tanpa judul)',
            docType:  params['doc_type']  || 'file',
            target:   params['target_user'] || null,
            visibility: params['visibility'] || null,
          });
        }
      }
      res.json({ total: activities.length, activities });
    } catch(err) { handleError(res, err); }
  });

};