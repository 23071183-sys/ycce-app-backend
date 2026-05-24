require('dotenv').config({ path: '/Users/yash/ycce-app-backend/.env' });
const { Pool } = require('pg');

const local = new Pool({
  host: 'localhost', user: 'postgres', database: 'ycce_app_db', port: 5432,
});

const cloud = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TABLES = [
  'users', 'subjects', 'timetable', 'announcements',
  'assignments', 'assignment_submissions', 'attendance',
  'compufest_committee', 'compufest_events',
  'fest_announcements', 'fest_events', 'notes',
  'results', 'semester_gpa',
];

async function migrate() {
  for (const table of TABLES) {
    const { rows } = await local.query(`SELECT * FROM ${table}`);
    if (!rows.length) { console.log(`${table}: empty, skipping`); continue; }

    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');

    await cloud.query(`TRUNCATE TABLE ${table} CASCADE`);

    let inserted = 0;
    for (const row of rows) {
      const vals = cols.map((c, i) => `$${i + 1}`).join(', ');
      const values = cols.map(c => row[c]);
      await cloud.query(`INSERT INTO ${table} (${colList}) VALUES (${vals}) ON CONFLICT DO NOTHING`, values);
      inserted++;
    }

    // Reset sequence after insert
    await cloud.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1)) FROM ${table}`).catch(() => {});
    console.log(`${table}: ${inserted} rows`);
  }
  console.log('\nDone!');
  await local.end();
  await cloud.end();
}

migrate().catch(e => { console.error(e.message); process.exit(1); });
