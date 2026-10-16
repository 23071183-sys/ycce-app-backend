require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const pool = require('./config/database');

// Auto-migrate: create missing tables and columns on every startup
(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        file_url TEXT,
        file_name TEXT,
        subject_id INT REFERENCES subjects(id) NOT NULL,
        posted_by INT REFERENCES users(id),
        unit INT,
        uploaded_by_role VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS semester_gpa (
        id SERIAL PRIMARY KEY,
        student_id INT REFERENCES users(id) NOT NULL,
        semester INT NOT NULL,
        sgpa NUMERIC(4,2) NOT NULL,
        academic_year VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, semester)
      );
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        student_id INT REFERENCES users(id) NOT NULL,
        subject_id INT REFERENCES subjects(id) NOT NULL,
        semester INT,
        internal_marks NUMERIC(5,2),
        external_marks NUMERIC(5,2),
        total_marks NUMERIC(5,2),
        grade VARCHAR(5),
        result VARCHAR(20),
        academic_year VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, subject_id, semester)
      );
    `);
    await client.query(`
      ALTER TABLE timetable ADD COLUMN IF NOT EXISTS custom_subject_name VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS can_post_general BOOLEAN DEFAULT false;
    `);
    await client.query(`UPDATE users SET status = 'approved' WHERE status IS NULL`);
    // Marks are entered per component. RE-MSE is sat by a student who missed
    // MSE 1 or MSE 2 and fills that slot; re_mse_for records which one.
    await client.query(`
      ALTER TABLE results ADD COLUMN IF NOT EXISTS mse1_marks numeric;
      ALTER TABLE results ADD COLUMN IF NOT EXISTS mse2_marks numeric;
      ALTER TABLE results ADD COLUMN IF NOT EXISTS ta_marks numeric;
      ALTER TABLE results ADD COLUMN IF NOT EXISTS ese_marks numeric;
      ALTER TABLE results ADD COLUMN IF NOT EXISTS re_mse_marks numeric;
      ALTER TABLE results ADD COLUMN IF NOT EXISTS re_mse_for VARCHAR(4);
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE results ADD CONSTRAINT results_re_mse_for_check
          CHECK (re_mse_for IS NULL OR re_mse_for IN ('mse1','mse2'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await require('./config/schema').migrateFeatures(client);
  } catch (e) {
    console.error('Auto-migrate error:', e.message);
  } finally {
    client.release();
  }
})();

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
// Razorpay signs the raw body, so the webhook must read it before express.json().
app.post('/api/fees/webhook', express.raw({ type: '*/*', limit: '1mb' }), require('./controllers/feePayments').webhook);
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/subjects', require('./routes/subjects'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/timetable', require('./routes/timetable'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/compufest', require('./routes/compufest'));
app.use('/api/fest', require('./routes/fest'));
app.use('/api/results', require('./routes/results'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/fees', require('./routes/fees'));
app.use('/api/placements', require('./routes/placements'));
app.use('/api/events', require('./routes/events'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/study', require('./routes/study'));
app.use('/api/settings', require('./routes/settings'));

// Serve locally-stored uploads (used when Cloudinary is unavailable)
app.use('/uploads', express.static(require('./config/cloudinary').UPLOAD_DIR));

app.get('/', (req, res) => {
  res.json({ message: 'YCCE CT App Backend Running' });
});

// Every minute: lecture start reminders
cron.schedule('* * * * *', async () => {
  const { checkAndSendLectureNotifications } = require('./controllers/timetableController');
  await checkAndSendLectureNotifications();
});

// Every hour: assignment deadline reminders (24h warning)
cron.schedule('0 * * * *', async () => {
  const { checkAndSendDeadlineNotifications } = require('./controllers/assignmentController');
  await checkAndSendDeadlineNotifications();
});

// Every 15 minutes: settle fee payments the Razorpay webhook missed
cron.schedule('*/15 * * * *', () => require('./controllers/feePayments').reconcilePending());

// 09:00 IST daily: late fees and fee reminders
cron.schedule('0 9 * * *', () => require('./controllers/feeController').dailyFeeJobs(), { timezone: 'Asia/Kolkata' });

// 02:00 IST nightly: award badges
cron.schedule('0 2 * * *', () => require('./controllers/progressController').nightly(), { timezone: 'Asia/Kolkata' });

app.use((err, req, res, next) => {
  // Multer/Cloudinary reject with plain objects, so err.stack is often undefined
  // and logging it alone prints "undefined", hiding the real cause.
  // Upload problems are the client's to fix, not server faults: report them as
  // such so the app can show the real reason.
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is too large' });
  }
  if (err?.status >= 400 && err?.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('Unhandled error on', req.method, req.originalUrl);
  console.error(err?.stack || err?.error?.message || err?.message || err);
  res.status(500).json({ error: err?.error?.message || err?.message || 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YCCE App Backend running on port ${PORT}`);
});

module.exports = app;