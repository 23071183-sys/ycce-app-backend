const crypto = require('crypto');
const pool = require('../config/database');

// Free registration for fest and compufest events, with a QR ticket that
// fest_admin or an admin scans at the door. A ticket checks in once.

const TABLES = { fest: 'fest_events', compufest: 'compufest_events' };
const CHECKERS = ['fest_admin', 'admin', 'super_admin'];

// ticket = type.eventId.random.sig; the signature lets the scanner reject a
// made-up code without touching the database.
const sign = (body) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(body).digest('base64url').slice(0, 12);
const makeTicket = (type, eventId) => {
  const body = `${type}.${eventId}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${body}.${sign(body)}`;
};
const ticketValid = (code) => {
  const parts = String(code || '').split('.');
  if (parts.length !== 4) return false;
  const body = parts.slice(0, 3).join('.');
  const a = Buffer.from(sign(body));
  const b = Buffer.from(parts[3]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const eventParams = (req) => {
  const type = req.params.type;
  const eventId = Number(req.params.eventId);
  return TABLES[type] && eventId > 0 ? { type, eventId, table: TABLES[type] } : null;
};

exports.register = async (req, res) => {
  const p = eventParams(req);
  if (!p) return res.status(404).json({ error: 'Event not found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the event so two last-seat registrations can't both get in.
    const { rows: [ev] } = await client.query(`SELECT * FROM ${p.table} WHERE id = $1 FOR UPDATE`, [p.eventId]);
    if (!ev || ev.is_active === false) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Event not found' }); }
    if (ev.event_date && new Date(ev.event_date) < new Date(Date.now() - 6 * 3600 * 1000)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This event is over' });
    }
    const { rows: [existing] } = await client.query(
      'SELECT * FROM event_registrations WHERE event_type = $1 AND event_id = $2 AND user_id = $3',
      [p.type, p.eventId, req.user.userId]
    );
    if (existing && existing.status !== 'cancelled') { await client.query('COMMIT'); return res.json(existing); }
    if (ev.capacity) {
      const { rows: [{ n }] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM event_registrations WHERE event_type = $1 AND event_id = $2 AND status <> 'cancelled'`,
        [p.type, p.eventId]
      );
      if (n >= ev.capacity) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This event is full' }); }
    }
    const { rows: [reg] } = existing
      ? await client.query(
        `UPDATE event_registrations SET status = 'registered', ticket_code = $2, created_at = now() WHERE id = $1 RETURNING *`,
        [existing.id, makeTicket(p.type, p.eventId)])
      : await client.query(
        `INSERT INTO event_registrations (event_type, event_id, user_id, ticket_code) VALUES ($1,$2,$3,$4) RETURNING *`,
        [p.type, p.eventId, req.user.userId, makeTicket(p.type, p.eventId)]);
    await client.query('COMMIT');
    res.status(201).json(reg);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.cancel = async (req, res) => {
  const p = eventParams(req);
  if (!p) return res.status(404).json({ error: 'Event not found' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE event_registrations SET status = 'cancelled'
       WHERE event_type = $1 AND event_id = $2 AND user_id = $3 AND status = 'registered'`,
      [p.type, p.eventId, req.user.userId]
    );
    if (!rowCount) return res.status(404).json({ error: 'No active registration' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.mine = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, COALESCE(f.title, c.title) AS title, COALESCE(f.event_date, c.event_date) AS event_date,
              COALESCE(f.venue, c.venue) AS venue
       FROM event_registrations r
       LEFT JOIN fest_events f ON r.event_type = 'fest' AND f.id = r.event_id
       LEFT JOIN compufest_events c ON r.event_type = 'compufest' AND c.id = r.event_id
       WHERE r.user_id = $1 AND r.status <> 'cancelled'
       ORDER BY COALESCE(f.event_date, c.event_date) DESC NULLS LAST`,
      [req.user.userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Registration counts for every event of a type, for the events lists.
exports.counts = async (req, res) => {
  const type = req.params.type;
  if (!TABLES[type]) return res.status(404).json({ error: 'Unknown event type' });
  try {
    const { rows } = await pool.query(
      `SELECT e.id AS event_id, e.capacity,
         COUNT(r.id) FILTER (WHERE r.status <> 'cancelled')::int AS registered,
         COUNT(r.id) FILTER (WHERE r.status = 'checked_in')::int AS checked_in,
         BOOL_OR(r.user_id = $1 AND r.status <> 'cancelled') AS mine
       FROM ${TABLES[type]} e LEFT JOIN event_registrations r ON r.event_type = $2 AND r.event_id = e.id
       GROUP BY e.id`,
      [req.user.userId, type]
    );
    res.json(rows.map(r => ({ ...r, mine: Boolean(r.mine) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.registrations = async (req, res) => {
  const p = eventParams(req);
  if (!p) return res.status(404).json({ error: 'Event not found' });
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.created_at, r.checked_in_at, u.id AS user_id, u.name, u.email, u.roll_number, u.year,
              ck.name AS checked_in_by_name
       FROM event_registrations r JOIN users u ON u.id = r.user_id
       LEFT JOIN users ck ON ck.id = r.checked_in_by
       WHERE r.event_type = $1 AND r.event_id = $2 AND r.status <> 'cancelled'
       ORDER BY u.name`,
      [p.type, p.eventId]
    );
    res.json({
      registered: rows.length,
      checked_in: rows.filter(r => r.status === 'checked_in').length,
      registrations: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.checkIn = async (req, res) => {
  const code = String(req.body?.ticket_code || '').trim();
  if (!ticketValid(code)) return res.status(400).json({ error: 'Not a valid ticket', result: 'invalid' });
  try {
    const { rows } = await pool.query(
      `UPDATE event_registrations SET status = 'checked_in', checked_in_at = now(), checked_in_by = $2
       WHERE ticket_code = $1 AND status = 'registered' RETURNING *`,
      [code, req.user.userId]
    );
    const { rows: [r] } = await pool.query(
      `SELECT r.*, u.name, u.roll_number, u.year, COALESCE(f.title, c.title) AS event_title
       FROM event_registrations r JOIN users u ON u.id = r.user_id
       LEFT JOIN fest_events f ON r.event_type = 'fest' AND f.id = r.event_id
       LEFT JOIN compufest_events c ON r.event_type = 'compufest' AND c.id = r.event_id
       WHERE r.ticket_code = $1`,
      [code]
    );
    if (!r) return res.status(404).json({ error: 'Ticket not found', result: 'invalid' });
    const who = { name: r.name, roll_number: r.roll_number, year: r.year, event_title: r.event_title };
    if (rows[0]) return res.json({ result: 'checked_in', ...who, checked_in_at: r.checked_in_at });
    if (r.status === 'cancelled') return res.status(409).json({ result: 'cancelled', error: 'This registration was cancelled', ...who });
    res.status(409).json({
      result: 'already',
      error: `Already checked in at ${new Date(r.checked_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`,
      ...who,
      checked_in_at: r.checked_in_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.CHECKERS = CHECKERS;
exports._internal = { makeTicket, ticketValid };
