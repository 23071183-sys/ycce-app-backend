const crypto = require('crypto');
const pool = require('../config/database');

// A private iCalendar feed per user. The calendar app subscribes to
// /api/calendar/<token>.ics and refreshes it by itself; the token is the only
// thing guarding it, so it is long, random, and can be reset.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 octets are folded with CRLF + space.
function fold(line) {
  const buf = Buffer.from(line);
  if (buf.length <= 75) return line;
  const out = [];
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), buf.length);
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) end--; // don't split a UTF-8 character
    out.push((start === 0 ? '' : ' ') + buf.slice(start, end).toString());
    start = end;
  }
  return out.join('\r\n');
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const utcStamp = (d) => `${ymd(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const hms = (t) => String(t).slice(0, 8).replace(/:/g, '');
// A date-only value (pg DATE comes back as a local-midnight Date) as YYYYMMDD.
const dateOnly = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
};

// The first date on/after `from` that falls on weekday `dow`, as YYYYMMDD (IST).
function nextWeekday(dow, from = new Date()) {
  const ist = new Date(from.getTime() + 5.5 * 3600_000);
  const diff = (dow - ist.getUTCDay() + 7) % 7;
  return ymd(new Date(ist.getTime() + diff * 86400_000));
}

const TZ = [
  'BEGIN:VTIMEZONE', 'TZID:Asia/Kolkata', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'TZNAME:IST', 'END:STANDARD', 'END:VTIMEZONE',
];

function buildCalendar(name, events) {
  const now = utcStamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//YCCE CT//App//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Asia/Kolkata',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H', ...TZ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@ycce-ct`, `DTSTAMP:${now}`, ...e.when, `SUMMARY:${esc(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

async function eventsFor(user) {
  const events = [];
  const isProf = user.role === 'professor';
  const subjectFilter = isProf ? 's.professor_id = $1' : 's.year = $1';
  const param = isProf ? user.id : user.year;
  if (!isProf && !user.year) return events;

  const { rows: classes } = await pool.query(
    `SELECT t.id, t.day, t.start_time, t.end_time, t.room, COALESCE(t.custom_subject_name, s.name) AS name, s.code
     FROM timetable t LEFT JOIN subjects s ON s.id = t.subject_id
     WHERE t.is_active IS NOT FALSE AND ${isProf ? 's.professor_id = $1' : 't.year = $1'}`,
    [param]
  );
  for (const c of classes) {
    const dow = DAYS.indexOf(c.day);
    if (dow < 0) continue;
    const first = nextWeekday(dow, new Date(Date.now() - 7 * 86400_000));
    events.push({
      uid: `class-${c.id}`,
      summary: c.name || 'Class',
      location: c.room,
      description: c.code || undefined,
      // Some rows have an end time before the start (e.g. 00:00); calendars
      // reject those, so fall back to an hour.
      when: [`DTSTART;TZID=Asia/Kolkata:${first}T${hms(c.start_time)}`,
        c.end_time && hms(c.end_time) > hms(c.start_time)
          ? `DTEND;TZID=Asia/Kolkata:${first}T${hms(c.end_time)}`
          : 'DURATION:PT1H'],
      rrule: `FREQ=WEEKLY;BYDAY=${ICS_DAY[dow]}`,
    });
  }

  const { rows: due } = await pool.query(
    `SELECT a.id, a.title, a.due_date, s.name FROM assignments a JOIN subjects s ON s.id = a.subject_id
     WHERE ${subjectFilter} AND a.due_date >= CURRENT_DATE - 30`,
    [param]
  );
  for (const a of due) {
    const d = dateOnly(a.due_date);
    events.push({ uid: `assignment-${a.id}`, summary: `Due: ${a.title}`, description: a.name,
      when: [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${ymd(new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6) + 1)))}`] });
  }

  const { rows: exams } = await pool.query(
    `SELECT e.id, e.exam_type, e.exam_date, e.start_time, e.room, s.name FROM exam_schedule e
     JOIN subjects s ON s.id = e.subject_id WHERE ${subjectFilter} AND e.exam_date >= CURRENT_DATE - 30`,
    [param]
  );
  for (const x of exams) {
    const d = dateOnly(x.exam_date);
    const label = x.exam_type.replace('_', '-');
    const when = x.start_time
      ? [`DTSTART;TZID=Asia/Kolkata:${d}T${hms(x.start_time)}`, 'DURATION:PT1H30M']
      : [`DTSTART;VALUE=DATE:${d}`];
    events.push({ uid: `exam-${x.id}`, summary: `${label}: ${x.name}`, location: x.room, when });
  }

  const { rows: regs } = await pool.query(
    `SELECT r.id, COALESCE(f.title, c.title) AS title, COALESCE(f.event_date, c.event_date) AS at,
            COALESCE(f.venue, c.venue) AS venue
     FROM event_registrations r
     LEFT JOIN fest_events f ON r.event_type = 'fest' AND f.id = r.event_id
     LEFT JOIN compufest_events c ON r.event_type = 'compufest' AND c.id = r.event_id
     WHERE r.user_id = $1 AND r.status <> 'cancelled'`,
    [user.id]
  );
  for (const r of regs) {
    if (!r.at) continue;
    const start = new Date(r.at);
    events.push({ uid: `event-${r.id}`, summary: r.title, location: r.venue,
      when: [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(new Date(start.getTime() + 2 * 3600_000))}`] });
  }
  return events;
}

exports.feed = async (req, res) => {
  const token = String(req.params.token || '').replace(/\.ics$/, '');
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return res.status(404).send('Not found');
  try {
    const { rows: [user] } = await pool.query(
      `SELECT id, name, role, year FROM users WHERE calendar_token = $1 AND status = 'approved'`, [token]
    );
    if (!user) return res.status(404).send('Not found');
    const ics = buildCalendar('YCCE CT', await eventsFor(user));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="ycce-ct.ics"');
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.send(ics);
  } catch (err) {
    console.error('Calendar feed:', err.message);
    res.status(500).send('Calendar unavailable');
  }
};

const newToken = () => crypto.randomBytes(32).toString('base64url');

const linkFor = (req, token) => {
  const base = (process.env.PUBLIC_BACKEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const https = `${base}/api/calendar/${token}.ics`;
  return {
    url: https,
    webcal: https.replace(/^https?:/, 'webcal:'),
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(https.replace(/^https?:/, 'webcal:'))}`,
  };
};

exports.link = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET calendar_token = COALESCE(calendar_token, $2) WHERE id = $1 RETURNING calendar_token`,
      [req.user.userId, newToken()]
    );
    res.json(linkFor(req, rows[0].calendar_token));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reset = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE users SET calendar_token = $2 WHERE id = $1 RETURNING calendar_token', [req.user.userId, newToken()]
    );
    res.json(linkFor(req, rows[0].calendar_token));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports._internal = { buildCalendar, eventsFor, fold, esc };
