const pool = require('../config/database');
const { notify } = require('../config/notifications');

// Placement drives. Admins manage them; students see them and apply on the
// company's own site (apply_url). Status comes from the dates unless an admin
// overrides it.

const STATUS_SQL = `
  COALESCE(d.status_override,
    CASE
      WHEN COALESCE(d.end_date, d.drive_date) < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'finished'
      WHEN d.drive_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'ongoing'
      ELSE 'upcoming' END)`;

const FIELDS = ['company', 'role', 'package_lpa', 'location', 'eligibility_cgpa', 'branches', 'description',
  'apply_url', 'apply_deadline', 'drive_date', 'end_date', 'rounds', 'status_override',
  'selected_count', 'selected_names', 'outcome_notes'];

const isDate = (s) => s == null || s === '' || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)));

function clean(body, partial) {
  const errors = [];
  const v = {};
  for (const f of FIELDS) if (body[f] !== undefined) v[f] = body[f] === '' ? null : body[f];
  if (!partial || v.company !== undefined) if (!v.company?.trim()) errors.push('Company is required');
  if (!partial || v.role !== undefined) if (!v.role?.trim()) errors.push('Role is required');
  if (v.package_lpa != null && !(Number(v.package_lpa) >= 0 && Number(v.package_lpa) < 10000)) errors.push('Package must be a number (LPA)');
  if (v.eligibility_cgpa != null && !(Number(v.eligibility_cgpa) >= 0 && Number(v.eligibility_cgpa) <= 10)) errors.push('CGPA cut-off must be 0 to 10');
  if (v.apply_url != null && !/^https?:\/\/\S+$/i.test(v.apply_url)) errors.push('Apply link must start with http:// or https://');
  for (const f of ['apply_deadline', 'drive_date', 'end_date']) if (!isDate(v[f])) errors.push(`${f.replace('_', ' ')} must be a date`);
  if (v.status_override != null && !['upcoming', 'ongoing', 'finished'].includes(v.status_override)) errors.push('Bad status');
  if (v.branches !== undefined) {
    if (v.branches === null) v.branches = [];
    if (!Array.isArray(v.branches) || v.branches.some(b => typeof b !== 'string')) errors.push('Branches must be a list');
  }
  if (v.rounds !== undefined) {
    if (v.rounds === null) v.rounds = [];
    if (!Array.isArray(v.rounds)) errors.push('Rounds must be a list');
    else v.rounds = JSON.stringify(v.rounds);
  }
  if (v.selected_count != null && !(Number.isInteger(Number(v.selected_count)) && Number(v.selected_count) >= 0)) errors.push('Selected count must be a whole number');
  return { v, errors };
}

const cgpaOf = async (userId) => {
  const { rows } = await pool.query('SELECT AVG(sgpa)::numeric(4,2) AS cgpa FROM semester_gpa WHERE student_id = $1', [userId]);
  return rows[0]?.cgpa != null ? Number(rows[0].cgpa) : null;
};

exports.list = async (req, res) => {
  const { status } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT d.*, ${STATUS_SQL} AS status FROM placement_drives d
       ORDER BY COALESCE(d.drive_date, d.apply_deadline) DESC NULLS LAST, d.id DESC`
    );
    let drives = status ? rows.filter(r => r.status === status) : rows;
    if (req.user.role === 'student') {
      const cgpa = await cgpaOf(req.user.userId);
      drives = drives.map(d => ({
        ...d,
        // null when we can't tell (no cut-off, or no SGPA entered yet)
        eligible: d.eligibility_cgpa == null ? true : cgpa == null ? null : cgpa >= Number(d.eligibility_cgpa),
        my_cgpa: cgpa,
      }));
    }
    res.json(drives);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.get = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT d.*, ${STATUS_SQL} AS status FROM placement_drives d WHERE d.id = $1`, [Number(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Drive not found' });
    const d = rows[0];
    if (req.user.role === 'student') {
      const cgpa = await cgpaOf(req.user.userId);
      d.my_cgpa = cgpa;
      d.eligible = d.eligibility_cgpa == null ? true : cgpa == null ? null : cgpa >= Number(d.eligibility_cgpa);
    }
    res.json(d);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  const { v, errors } = clean(req.body || {}, false);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const cols = Object.keys(v);
  try {
    const { rows } = await pool.query(
      `INSERT INTO placement_drives (${cols.join(', ')}, created_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1})
       RETURNING *`,
      [...cols.map(c => v[c]), req.user.userId]
    );
    const d = rows[0];
    // Tell students who meet the cut-off (or who have no SGPA on record yet).
    const { rows: students } = await pool.query(
      `SELECT u.expo_push_token, u.notification_prefs FROM users u
       LEFT JOIN (SELECT student_id, AVG(sgpa) AS cgpa FROM semester_gpa GROUP BY student_id) g ON g.student_id = u.id
       WHERE u.role = 'student' AND u.status = 'approved'
         AND ($1::numeric IS NULL OR g.cgpa IS NULL OR g.cgpa >= $1)`,
      [d.eligibility_cgpa]
    );
    notify(students, 'placements', `${d.company} is hiring`,
      `${d.role}${d.package_lpa ? ` · ${Number(d.package_lpa)} LPA` : ''}${d.apply_deadline ? ` · apply by ${new Date(d.apply_deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}`,
      { type: 'placement', driveId: d.id });
    res.status(201).json(d);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  const { v, errors } = clean(req.body || {}, true);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const cols = Object.keys(v);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const { rows } = await pool.query(
      `UPDATE placement_drives SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [Number(req.params.id), ...cols.map(c => v[c])]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Drive not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM placement_drives WHERE id = $1', [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Drive not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
