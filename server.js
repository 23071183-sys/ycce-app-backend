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

app.use((err, req, res, next) => {
  // Multer/Cloudinary reject with plain objects, so err.stack is often undefined
  // and logging it alone prints "undefined", hiding the real cause.
  console.error('Unhandled error on', req.method, req.originalUrl);
  console.error(err?.stack || err?.error?.message || err?.message || err);
  res.status(500).json({ error: err?.error?.message || err?.message || 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YCCE App Backend running on port ${PORT}`);
});

module.exports = app;