// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES: DASHBOARD — /api/dashboard/stats
// ═══════════════════════════════════════════════════════════════════════════════

const { getDirForDashboard, getClassroomForDashboard, handleError } = require('../helpers/auth');

module.exports = function(app) {

  app.get('/api/dashboard/stats', async (req, res) => {
    try {
      const [dir, classroom] = await Promise.all([
        getDirForDashboard(),
        getClassroomForDashboard(),
      ]);

      const [usersRes, coursesRes, orgunitsRes] = await Promise.all([
        dir.users.list({ customer: 'my_customer', maxResults: 500 }),
        classroom.courses.list({ pageSize: 50 }),
        dir.orgunits.list({ customerId: 'my_customer', type: 'all' }),
      ]);

      const users     = usersRes.data.users || [];
      const courses   = coursesRes.data.courses || [];
      const orgunits  = orgunitsRes.data.organizationUnits || [];
      const suspended = users.filter(u => u.suspended).length;

      const ouMap = {};
      orgunits.forEach(ou => { ouMap[ou.orgUnitPath] = 0; });
      users.forEach(u => {
        const p = u.orgUnitPath || '/';
        ouMap[p] = (ouMap[p] || 0) + 1;
      });

      const ouStats = Object.entries(ouMap)
        .filter(([k]) => k !== '/')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([path, count]) => ({ name: path.split('/').pop(), path, count }));

      const recentUsers = users
        .filter(u => u.creationTime)
        .sort((a, b) => new Date(b.creationTime) - new Date(a.creationTime))
        .slice(0, 5)
        .map(u => ({
          name: u.name?.fullName || '-',
          email: u.primaryEmail,
          createdAt: u.creationTime,
          ou: u.orgUnitPath || '/',
        }));

      res.json({
        success: true,
        data: {
          users:    { total: users.length, active: users.length - suspended, suspended },
          courses:  {
            total:    courses.length,
            active:   courses.filter(c => c.courseState === 'ACTIVE').length,
            archived: courses.filter(c => c.courseState !== 'ACTIVE').length,
          },
          orgunits: { total: orgunits.length, distribution: ouStats },
          recentUsers,
        }
      });
    } catch(err) { handleError(res, err); }
  });

};
