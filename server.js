require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');

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