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
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YCCE App Backend running on port ${PORT}`);
});

module.exports = app;