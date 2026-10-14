const { Pool } = require('pg');
require('dotenv').config();

// LOCAL_DATABASE_URL overrides .env, so a local Postgres can be used for development.
const connectionString = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;

// Local Postgres doesn't serve SSL; hosted providers require it.
const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString || '');

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: isLocalDb ? false : { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      // The hosted database sits in ap-northeast-1 and takes ~3s on a cold query,
      // longer while the instance is waking, so 5s cut off legitimate waits.
      connectionTimeoutMillis: isLocalDb ? 2000 : 10000,
    })
  : new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

// An idle client can drop for reasons that say nothing about the server's health:
// the hosted database pausing, a dropped socket, a provider-side restart. The pool
// discards the bad client and opens a fresh one on the next query, so exiting here
// turned a recoverable blip into a full outage.
pool.on('error', (err) => {
  console.error('Unexpected error on idle client:', err.message);
});

module.exports = pool;
