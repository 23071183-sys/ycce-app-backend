require('dotenv').config();
const pool = require('../config/database');
const migrate = async () => {
const client = await pool.connect();
try {
await client.query('BEGIN');
// Users table
await client.query(`
CREATE TABLE IF NOT EXISTS users (
id SERIAL PRIMARY KEY,
name VARCHAR(255) NOT NULL,
email VARCHAR(255) UNIQUE NOT NULL,
password VARCHAR(255) NOT NULL,
role VARCHAR(50) NOT NULL DEFAULT 'student',
year INT,
roll_number VARCHAR(50),
department VARCHAR(100) DEFAULT 'Computer Technology',
fcm_token TEXT,
expo_push_token TEXT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// Subjects table
await client.query(`
CREATE TABLE IF NOT EXISTS subjects (
id SERIAL PRIMARY KEY,
name VARCHAR(255) NOT NULL,
code VARCHAR(50),
year INT NOT NULL,
semester INT,
professor_id INT REFERENCES users(id),
department VARCHAR(100) DEFAULT 'Computer Technology',
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// Announcements table
await client.query(`
CREATE TABLE IF NOT EXISTS announcements (
id SERIAL PRIMARY KEY,
title VARCHAR(255) NOT NULL,
content TEXT NOT NULL,
type VARCHAR(50) NOT NULL,
subject_id INT REFERENCES subjects(id),
year INT,
is_cancelled BOOLEAN DEFAULT false,
posted_by INT REFERENCES users(id),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// type: 'general', 'year_specific', 'subject_specific'
// Assignments table
await client.query(`
CREATE TABLE IF NOT EXISTS assignments (
id SERIAL PRIMARY KEY,
title VARCHAR(255) NOT NULL,
description TEXT,
subject_id INT REFERENCES subjects(id) NOT NULL,
due_date TIMESTAMP NOT NULL,
file_url TEXT,
file_name TEXT,
posted_by INT REFERENCES users(id),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// Assignment submissions
await client.query(`
CREATE TABLE IF NOT EXISTS assignment_submissions (
id SERIAL PRIMARY KEY,
assignment_id INT REFERENCES assignments(id) NOT NULL,
student_id INT REFERENCES users(id) NOT NULL,
file_url TEXT,
file_name TEXT,
content TEXT,
submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
grade VARCHAR(10),
feedback TEXT,
UNIQUE(assignment_id, student_id)
);
`);
// Timetable table
await client.query(`
CREATE TABLE IF NOT EXISTS timetable (
id SERIAL PRIMARY KEY,
subject_id INT REFERENCES subjects(id) NOT NULL,
year INT NOT NULL,
day VARCHAR(20) NOT NULL,
start_time TIME NOT NULL,
end_time TIME NOT NULL,
room VARCHAR(50),
is_active BOOLEAN DEFAULT true,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// Attendance table
await client.query(`
CREATE TABLE IF NOT EXISTS attendance (
id SERIAL PRIMARY KEY,
student_id INT REFERENCES users(id) NOT NULL,
subject_id INT REFERENCES subjects(id) NOT NULL,
date DATE NOT NULL,
status VARCHAR(20) NOT NULL DEFAULT 'absent',
marked_by INT REFERENCES users(id),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
UNIQUE(student_id, subject_id, date)
);
`);
// Compufest committee
await client.query(`
CREATE TABLE IF NOT EXISTS compufest_committee (
id SERIAL PRIMARY KEY,
name VARCHAR(255) NOT NULL,
position VARCHAR(100) NOT NULL,
hierarchy_order INT NOT NULL,
linkedin_url TEXT,
photo_url TEXT,
contact VARCHAR(20),
year INT,
is_faculty_coordinator BOOLEAN DEFAULT false,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// Compufest events
await client.query(`
CREATE TABLE IF NOT EXISTS compufest_events (
id SERIAL PRIMARY KEY,
title VARCHAR(255) NOT NULL,
description TEXT,
event_date TIMESTAMP,
venue VARCHAR(255),
registration_link TEXT,
banner_url TEXT,
is_active BOOLEAN DEFAULT true,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// College Cultural Fest (Yash) events
await client.query(`
CREATE TABLE IF NOT EXISTS fest_events (
id SERIAL PRIMARY KEY,
title VARCHAR(255) NOT NULL,
description TEXT,
event_date TIMESTAMP,
venue VARCHAR(255),
registration_link TEXT,
banner_url TEXT,
category VARCHAR(100),
is_active BOOLEAN DEFAULT true,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// Fest announcements
await client.query(`
CREATE TABLE IF NOT EXISTS fest_announcements (
id SERIAL PRIMARY KEY,
title VARCHAR(255) NOT NULL,
content TEXT NOT NULL,
fest_type VARCHAR(50) NOT NULL,
posted_by INT REFERENCES users(id),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
// fest_type: 'compufest' or 'yash'
// Push notification logs
await client.query(`
CREATE TABLE IF NOT EXISTS notification_logs (
id SERIAL PRIMARY KEY,
user_id INT REFERENCES users(id),
title VARCHAR(255),
body TEXT,
type VARCHAR(50),
sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
await client.query('COMMIT');
console.log('All tables created successfully!');
} catch (err) {
await client.query('ROLLBACK');
console.error('Migration failed:', err);
} finally {
client.release();
pool.end();
}
};
migrate();