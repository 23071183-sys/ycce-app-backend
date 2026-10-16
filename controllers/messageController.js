const pool = require('../config/database');
const { notify } = require('../config/notifications');

// Direct messages between a student and the professors who teach their year,
// and between a student and admins. Nothing else: no student-to-student, no
// staff-to-staff. Conversations are one thread per pair of people.

const ADMIN_ROLES = ['admin', 'super_admin'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 50;

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

const loadUser = async (id) => {
  const { rows } = await pool.query(
    'SELECT id, name, role, year, status, avatar_url, expo_push_token, notification_prefs FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
};

// Whether a and b may message each other, and which kind of thread it is.
// Subjects are linked to students by year (there is no enrolment table), so a
// professor teaches a student when some subject they own is in that year.
async function messagingKind(a, b) {
  if (!a || !b || a.id === b.id) return null;
  if (a.status !== 'approved' || b.status !== 'approved') return null;
  const student = a.role === 'student' ? a : b.role === 'student' ? b : null;
  const other = student === a ? b : a;
  if (!student || other.role === 'student') return null;
  if (ADMIN_ROLES.includes(other.role)) return 'student_admin';
  if (other.role === 'professor') {
    const { rows } = await pool.query(
      'SELECT 1 FROM subjects WHERE professor_id = $1 AND year = $2 LIMIT 1',
      [other.id, student.year]
    );
    return rows.length ? 'student_professor' : null;
  }
  return null;
}

// Simple per-user send limit. One Render instance, so memory is enough.
const sendLog = new Map();
const rateLimited = (userId) => {
  const now = Date.now();
  const recent = (sendLog.get(userId) || []).filter(t => now - t < 60000);
  if (recent.length >= 30) { sendLog.set(userId, recent); return true; }
  recent.push(now);
  sendLog.set(userId, recent);
  return false;
};

// The participant row for this user in this conversation, or null. Callers
// answer 404 rather than 403 when it's missing, so conversation ids can't be
// probed.
const participant = async (conversationId, userId) => {
  const { rows } = await pool.query(
    'SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId]
  );
  return rows[0] || null;
};

exports.getContacts = async (req, res) => {
  const { q, year } = req.query;
  try {
    const me = await loadUser(req.user.userId);
    if (!me || me.status !== 'approved') return res.json([]);
    const search = q ? `%${String(q).trim()}%` : null;
    let rows;

    if (me.role === 'student') {
      ({ rows } = await pool.query(
        `SELECT u.id, u.name, u.role, u.designation, u.avatar_url,
                COALESCE(array_agg(s.name ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL), '{}') AS subjects
         FROM users u
         LEFT JOIN subjects s ON s.professor_id = u.id AND s.year = $1
         WHERE u.status = 'approved'
           AND (u.role IN ('admin','super_admin')
                OR (u.role = 'professor' AND EXISTS (SELECT 1 FROM subjects s2 WHERE s2.professor_id = u.id AND s2.year = $1)))
           AND ($2::text IS NULL OR u.name ILIKE $2)
         GROUP BY u.id
         ORDER BY (u.role = 'professor') DESC, u.name`,
        [me.year, search]
      ));
    } else if (me.role === 'professor') {
      ({ rows } = await pool.query(
        `SELECT u.id, u.name, u.role, u.year, u.roll_number, u.avatar_url
         FROM users u
         WHERE u.role = 'student' AND u.status = 'approved'
           AND u.year IN (SELECT year FROM subjects WHERE professor_id = $1)
           AND ($2::int IS NULL OR u.year = $2)
           AND ($3::text IS NULL OR u.name ILIKE $3 OR u.roll_number ILIKE $3)
         ORDER BY u.year, u.roll_number NULLS LAST, u.name
         LIMIT 200`,
        [me.id, year ? Number(year) : null, search]
      ));
    } else if (ADMIN_ROLES.includes(me.role)) {
      ({ rows } = await pool.query(
        `SELECT u.id, u.name, u.role, u.year, u.roll_number, u.avatar_url
         FROM users u
         WHERE u.role = 'student' AND u.status = 'approved'
           AND ($1::int IS NULL OR u.year = $1)
           AND ($2::text IS NULL OR u.name ILIKE $2 OR u.roll_number ILIKE $2)
         ORDER BY u.year, u.roll_number NULLS LAST, u.name
         LIMIT 200`,
        [year ? Number(year) : null, search]
      ));
    } else {
      rows = [];
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.listConversations = async (req, res) => {
  const me = req.user.userId;
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.kind, c.subject_id, c.last_message_at, c.last_message_preview, p.muted,
              json_build_object('id', o.id, 'name', o.name, 'role', o.role, 'avatar_url', o.avatar_url,
                                'year', o.year, 'roll_number', o.roll_number) AS other,
              (SELECT COUNT(*)::int FROM messages m
                WHERE m.conversation_id = c.id AND m.id > p.last_read_message_id
                  AND m.sender_id <> $1 AND m.deleted_at IS NULL) AS unread
       FROM conversation_participants p
       JOIN conversations c ON c.id = p.conversation_id
       JOIN conversation_participants op ON op.conversation_id = c.id AND op.user_id <> $1
       JOIN users o ON o.id = op.user_id
       WHERE p.user_id = $1
       ORDER BY c.last_message_at DESC`,
      [me]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.startConversation = async (req, res) => {
  const recipientId = Number(req.body?.recipient_id);
  const subjectId = req.body?.subject_id ? Number(req.body.subject_id) : null;
  if (!recipientId) return res.status(400).json({ error: 'recipient_id is required' });
  try {
    const [me, them] = await Promise.all([loadUser(req.user.userId), loadUser(recipientId)]);
    const kind = await messagingKind(me, them);
    if (!kind) return res.status(403).json({ error: "You can't message this person" });

    const key = pairKey(me.id, them.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // ON CONFLICT DO UPDATE (a no-op) so RETURNING gives the row either way.
      const { rows } = await client.query(
        `INSERT INTO conversations (kind, pair_key, subject_id, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (pair_key) DO UPDATE SET pair_key = EXCLUDED.pair_key
         RETURNING *, (xmax = 0) AS created`,
        [kind, key, subjectId, me.id]
      );
      const conv = rows[0];
      await client.query(
        `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)
         ON CONFLICT DO NOTHING`,
        [conv.id, me.id, them.id]
      );
      await client.query('COMMIT');
      res.status(conv.created ? 201 : 200).json({
        id: conv.id,
        kind: conv.kind,
        other: { id: them.id, name: them.name, role: them.role, avatar_url: them.avatar_url },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMessages = async (req, res) => {
  const conversationId = Number(req.params.id);
  const after = req.query.after ? Number(req.query.after) : null;
  const before = req.query.before ? Number(req.query.before) : null;
  const limit = Math.min(Number(req.query.limit) || PAGE, 100);
  try {
    if (!(await participant(conversationId, req.user.userId))) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    let rows;
    if (after !== null) {
      // Polling: everything newer than what the client already has.
      ({ rows } = await pool.query(
        `SELECT id, sender_id, body, client_id, created_at FROM messages
         WHERE conversation_id = $1 AND id > $2 AND deleted_at IS NULL
         ORDER BY id ASC LIMIT $3`,
        [conversationId, after, limit]
      ));
    } else {
      // History: the latest page, or the page before a given id.
      ({ rows } = await pool.query(
        `SELECT id, sender_id, body, client_id, created_at FROM messages
         WHERE conversation_id = $1 AND ($2::bigint IS NULL OR id < $2) AND deleted_at IS NULL
         ORDER BY id DESC LIMIT $3`,
        [conversationId, before, limit]
      ));
      rows.reverse();
    }
    const other = await pool.query(
      `SELECT p.last_read_message_id FROM conversation_participants p
       WHERE p.conversation_id = $1 AND p.user_id <> $2`,
      [conversationId, req.user.userId]
    );
    res.json({ messages: rows, otherLastRead: Number(other.rows[0]?.last_read_message_id || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.sendMessage = async (req, res) => {
  const conversationId = Number(req.params.id);
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  const clientId = req.body?.client_id && UUID_RE.test(req.body.client_id) ? req.body.client_id : null;
  if (!body) return res.status(400).json({ error: 'Message is empty' });
  if (body.length > 4000) return res.status(400).json({ error: 'Message is too long (4000 characters max)' });
  try {
    if (!(await participant(conversationId, req.user.userId))) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    // Permission is checked on every send, not just when the thread started, so
    // someone who no longer teaches the student loses the right to message
    // (the history stays readable).
    const other = await pool.query(
      'SELECT user_id, muted FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2',
      [conversationId, req.user.userId]
    );
    const [me, them] = await Promise.all([loadUser(req.user.userId), loadUser(other.rows[0]?.user_id)]);
    if (!(await messagingKind(me, them))) {
      return res.status(403).json({ error: "You can't message this person any more" });
    }
    if (rateLimited(me.id)) return res.status(429).json({ error: 'You are sending messages too fast. Wait a moment.' });

    let { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, body, client_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sender_id, client_id) DO NOTHING
       RETURNING id, sender_id, body, client_id, created_at`,
      [conversationId, me.id, body, clientId]
    );
    // A retry of a send that already succeeded: return the original.
    if (rows.length === 0) {
      ({ rows } = await pool.query(
        'SELECT id, sender_id, body, client_id, created_at FROM messages WHERE sender_id = $1 AND client_id = $2',
        [me.id, clientId]
      ));
      return res.status(200).json(rows[0]);
    }
    const msg = rows[0];
    await pool.query(
      `UPDATE conversations SET last_message_at = $2, last_message_preview = $3 WHERE id = $1`,
      [conversationId, msg.created_at, body.slice(0, 140)]
    );
    await pool.query(
      `UPDATE conversation_participants SET last_read_message_id = GREATEST(last_read_message_id, $3)
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, me.id, msg.id]
    );
    if (!other.rows[0]?.muted) {
      notify([them], 'messages', me.name, body.slice(0, 120), { type: 'message', conversationId });
    }
    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markRead = async (req, res) => {
  const conversationId = Number(req.params.id);
  const lastId = Number(req.body?.last_message_id);
  if (!lastId) return res.status(400).json({ error: 'last_message_id is required' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE conversation_participants SET last_read_message_id = GREATEST(last_read_message_id, $3)
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, req.user.userId, lastId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.setMuted = async (req, res) => {
  const conversationId = Number(req.params.id);
  const muted = req.body?.muted === true;
  try {
    const { rowCount } = await pool.query(
      'UPDATE conversation_participants SET muted = $3 WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.user.userId, muted]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ muted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.unreadCount = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM conversation_participants p
       JOIN messages m ON m.conversation_id = p.conversation_id
       WHERE p.user_id = $1 AND m.id > p.last_read_message_id
         AND m.sender_id <> $1 AND m.deleted_at IS NULL`,
      [req.user.userId]
    );
    res.json({ total: rows[0].total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports._internal = { messagingKind, pairKey };
