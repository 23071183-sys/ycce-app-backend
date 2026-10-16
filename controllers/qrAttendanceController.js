const crypto = require('crypto');
const pool = require('../config/database');

// QR attendance. The professor's screen shows a code that changes every 10
// seconds (HMAC of the session secret and the time window), so a photo sent to
// a friend outside the room is useless within ~20 seconds. A scan writes the
// same attendance row as manual marking; closing the session marks everyone
// else in that year absent (without overwriting anything already marked).

const WINDOW_MS = 10_000;
const MAX_OPEN_MS = 3 * 3600_000;
const ADMIN_ROLES = ['admin', 'super_admin'];

const windowOf = (t = Date.now()) => Math.floor(t / WINDOW_MS);
const tokenFor = (secret, w) => crypto.createHmac('sha256', secret).update(String(w)).digest('base64url').slice(0, 16);
const tokenOk = (secret, token) => {
  const w = windowOf();
  return [w, w - 1].some(x => {
    const a = Buffer.from(tokenFor(secret, x));
    const b = Buffer.from(String(token || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
};

// Metres between two lat/lng points.
function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A session's geofence, else the campus one from the environment, else none.
const fenceFor = (session) => {
  if (session.geofence?.lat != null) return session.geofence;
  const { CAMPUS_LAT, CAMPUS_LNG, CAMPUS_RADIUS_M } = process.env;
  return CAMPUS_LAT && CAMPUS_LNG
    ? { lat: Number(CAMPUS_LAT), lng: Number(CAMPUS_LNG), radius_m: Number(CAMPUS_RADIUS_M) || 300 }
    : null;
};

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const loadOwned = async (id, user) => {
  const { rows } = await pool.query(
    `SELECT a.*, s.year, s.name AS subject_name FROM attendance_sessions a JOIN subjects s ON s.id = a.subject_id WHERE a.id = $1`,
    [id]
  );
  const s = rows[0];
  if (!s || (s.professor_id !== user.userId && !ADMIN_ROLES.includes(user.role))) return null;
  return s;
};

const isOpen = (s) => !s.closed_at && Date.now() - new Date(s.opened_at).getTime() < MAX_OPEN_MS;

exports.start = async (req, res) => {
  const subjectId = Number(req.body?.subject_id);
  const g = req.body?.geofence;
  if (!subjectId) return res.status(400).json({ error: 'subject_id is required' });
  if (g && !(Number.isFinite(+g.lat) && Number.isFinite(+g.lng) && +g.radius_m > 0)) {
    return res.status(400).json({ error: 'Geofence needs lat, lng and radius_m' });
  }
  try {
    const { rows: [subj] } = await pool.query('SELECT * FROM subjects WHERE id = $1', [subjectId]);
    if (!subj) return res.status(404).json({ error: 'Subject not found' });
    if (subj.professor_id !== req.user.userId && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'You can only take attendance for your own subjects' });
    }
    // One open session per subject: reuse it if it's still running.
    const { rows: open } = await pool.query(
      `SELECT * FROM attendance_sessions WHERE subject_id = $1 AND closed_at IS NULL
         AND opened_at > now() - interval '3 hours' ORDER BY id DESC LIMIT 1`,
      [subjectId]
    );
    if (open[0]) return res.json({ id: open[0].id, subject_id: subjectId, date: open[0].date, opened_at: open[0].opened_at, reused: true });
    const { rows: [s] } = await pool.query(
      `INSERT INTO attendance_sessions (subject_id, professor_id, date, secret, geofence)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, subject_id, date, opened_at`,
      [subjectId, req.user.userId, istToday(), crypto.randomBytes(32).toString('hex'),
       g ? { lat: +g.lat, lng: +g.lng, radius_m: +g.radius_m } : null]
    );
    res.status(201).json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Polled by the professor's screen every few seconds.
exports.token = async (req, res) => {
  try {
    const s = await loadOwned(Number(req.params.id), req.user);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (!isOpen(s)) return res.status(409).json({ error: 'Session is closed' });
    const w = windowOf();
    const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM attendance_session_scans WHERE session_id = $1', [s.id]);
    res.json({
      qr: `ycce-att:${s.id}:${tokenFor(s.secret, w)}`,
      refresh_in_ms: (w + 1) * WINDOW_MS - Date.now(),
      scanned: n,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.scan = async (req, res) => {
  const m = /^ycce-att:(\d+):([\w-]+)$/.exec(String(req.body?.qr || ''));
  if (!m) return res.status(400).json({ error: "That isn't an attendance code" });
  const sessionId = Number(m[1]);
  try {
    const { rows: [s] } = await pool.query(
      `SELECT a.*, s.year, s.name AS subject_name FROM attendance_sessions a JOIN subjects s ON s.id = a.subject_id WHERE a.id = $1`,
      [sessionId]
    );
    if (!s || !isOpen(s)) return res.status(410).json({ error: 'This attendance session has ended' });
    if (!tokenOk(s.secret, m[2])) return res.status(410).json({ error: 'Code expired — scan the screen again' });

    const { rows: [me] } = await pool.query('SELECT id, role, year, status FROM users WHERE id = $1', [req.user.userId]);
    if (me?.role !== 'student' || me.status !== 'approved') return res.status(403).json({ error: 'Only students can scan in' });
    if (me.year !== s.year) return res.status(403).json({ error: `This class is for year ${s.year}` });

    const fence = fenceFor(s);
    if (fence) {
      const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Location is needed to mark attendance' });
      if (distance(fence, { lat, lng }) > fence.radius_m) return res.status(403).json({ error: "You don't seem to be in class" });
    }

    const { rowCount } = await pool.query(
      'INSERT INTO attendance_session_scans (session_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [s.id, me.id]
    );
    if (!rowCount) return res.status(409).json({ error: 'Already marked present', subject: s.subject_name });
    await pool.query(
      `INSERT INTO attendance (student_id, subject_id, date, status, marked_by)
       VALUES ($1, $2, $3, 'present', $4)
       ON CONFLICT (student_id, subject_id, date) DO UPDATE SET status = 'present'`,
      [me.id, s.subject_id, s.date, s.professor_id]
    );
    res.json({ ok: true, subject: s.subject_name, date: s.date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.detail = async (req, res) => {
  try {
    const s = await loadOwned(Number(req.params.id), req.user);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const { rows: scans } = await pool.query(
      `SELECT u.id, u.name, u.roll_number, sc.scanned_at FROM attendance_session_scans sc
       JOIN users u ON u.id = sc.student_id WHERE sc.session_id = $1 ORDER BY sc.scanned_at`,
      [s.id]
    );
    const { rows: [{ n }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = 'student' AND status = 'approved' AND year = $1`, [s.year]
    );
    const { secret, ...pub } = s;
    res.json({ ...pub, open: isOpen(s), scans, class_size: n });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.close = async (req, res) => {
  const client = await pool.connect();
  try {
    const s = await loadOwned(Number(req.params.id), req.user);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'UPDATE attendance_sessions SET closed_at = now() WHERE id = $1 AND closed_at IS NULL', [s.id]
    );
    let absent = 0;
    if (rowCount) {
      // Students in the year who didn't scan and have no mark yet that day.
      const r = await client.query(
        `INSERT INTO attendance (student_id, subject_id, date, status, marked_by)
         SELECT u.id, $1, $2, 'absent', $3 FROM users u
         WHERE u.role = 'student' AND u.status = 'approved' AND u.year = $4
           AND NOT EXISTS (SELECT 1 FROM attendance_session_scans sc WHERE sc.session_id = $5 AND sc.student_id = u.id)
         ON CONFLICT (student_id, subject_id, date) DO NOTHING`,
        [s.subject_id, s.date, s.professor_id, s.year, s.id]
      );
      absent = r.rowCount;
    }
    await client.query('COMMIT');
    const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM attendance_session_scans WHERE session_id = $1', [s.id]);
    res.json({ closed: true, present: n, marked_absent: absent });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports._internal = { tokenFor, tokenOk, windowOf, distance };
