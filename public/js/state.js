// ── STATE — semua variabel global ─────────────────────────────────────────────

let allUsers      = [];
let allCourses    = [];
let allOrgUnits   = [];
let chosenStudents     = [];
let addStudentSelected = {};
let currentCourseId    = null;
let sortState  = { col: null, dir: 'asc' };
let bmouSelected = {};   // bulk move OU
let blSelected   = {};   // bulk license
let bdSelected   = {};   // bulk delete
