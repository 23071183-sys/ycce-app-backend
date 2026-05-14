const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const doc = new PDFDocument({ margin: 50, size: 'A4' });
const out = path.join(__dirname, '../YCCE-CT-App-Overview.pdf');
doc.pipe(fs.createWriteStream(out));

const BLACK = '#0f0f0f';
const GRAY = '#555555';
const LIGHT = '#888888';
const ACCENT = '#B91C1C';
const BG_SECTION = '#f5f5f5';

function heading1(text) {
  doc.moveDown(0.5)
    .fontSize(20).font('Helvetica-Bold').fillColor(BLACK)
    .text(text, { underline: false })
    .moveDown(0.4);
}

function heading2(text) {
  doc.moveDown(0.6)
    .fontSize(13).font('Helvetica-Bold').fillColor(ACCENT)
    .text(text.toUpperCase(), { characterSpacing: 1.5 })
    .moveDown(0.2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
}

function heading3(text) {
  doc.moveDown(0.4)
    .fontSize(11).font('Helvetica-Bold').fillColor(BLACK)
    .text(text)
    .moveDown(0.15);
}

function bullet(label, desc) {
  const labelW = doc.widthOfString(label + ' — ', { font: 'Helvetica-Bold', size: 10 });
  doc.fontSize(10).font('Helvetica-Bold').fillColor(BLACK)
    .text(label + ' — ', { continued: true })
    .font('Helvetica').fillColor(GRAY)
    .text(desc)
    .moveDown(0.15);
}

function plainText(text) {
  doc.fontSize(10).font('Helvetica').fillColor(GRAY).text(text).moveDown(0.15);
}

function tableRow(col1, col2, col3, isHeader = false) {
  const y = doc.y;
  const col = [50, 200, 350];
  const font = isHeader ? 'Helvetica-Bold' : 'Helvetica';
  const color = isHeader ? BLACK : GRAY;
  doc.fontSize(9).font(font).fillColor(color);
  doc.text(col1, col[0], y, { width: 145 });
  doc.text(col2, col[1], y, { width: 145 });
  doc.text(col3, col[2], y, { width: 195 });
  doc.moveDown(isHeader ? 0.5 : 0.35);
  if (isHeader) {
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
  }
}

// ─── COVER ───────────────────────────────────────────────────────────────────
doc.rect(0, 0, 595, 120).fill(ACCENT);
doc.fontSize(28).font('Helvetica-Bold').fillColor('#ffffff')
  .text('YCCE CT App', 50, 35, { align: 'center' });
doc.fontSize(12).font('Helvetica').fillColor('#ffcccc')
  .text('System Overview — Admin & Faculty Reference', 50, 72, { align: 'center' });
doc.moveDown(3);

// ─── SECTION 1: WHAT IS IT ───────────────────────────────────────────────────
heading1('What is it?');
plainText(
  'A full-stack college management system built for the Computer Technology department at YCCE. ' +
  'It has two parts — a mobile app for students and faculty, and a web-based admin dashboard for administrators and professors.'
);

// ─── SECTION 2: TECH STACK ───────────────────────────────────────────────────
heading2('Technologies Used');

heading3('Backend');
bullet('Node.js', 'Runs the server');
bullet('Express.js', 'Handles routes and API endpoints');
bullet('PostgreSQL', 'Stores all app data');
bullet('node-postgres (pg)', 'Connects Node.js to PostgreSQL');
bullet('JWT (jsonwebtoken)', 'Issues and verifies login tokens');
bullet('bcryptjs', 'Hashes and verifies passwords');
bullet('Multer', 'Parses file uploads from requests');
bullet('Cloudinary', 'Stores uploaded files (notes, assignments) on the cloud');
bullet('Nodemailer', 'Sends OTP emails for verification and password reset');
bullet('node-cron', 'Runs scheduled tasks every minute/hour automatically');
bullet('helmet', 'Adds security headers to every response');
bullet('cors', 'Allows the web dashboard and app to talk to the backend');
bullet('morgan', 'Logs every incoming request in the terminal');
bullet('dotenv', 'Loads secret keys and config from the .env file');

heading3('Mobile App');
bullet('React Native', 'Builds the UI for both iOS and Android from one codebase');
bullet('Expo SDK 54', 'Simplifies building, running, and deploying the app');
bullet('expo-notifications', 'Requests permission and receives push notifications');
bullet('expo-document-picker', 'Lets users pick files from their device to upload');
bullet('AsyncStorage', 'Saves login token locally so users stay logged in');
bullet('axios', 'Makes HTTP requests to the backend API');
bullet('React Navigation', 'Moves between screens (login, home, subject detail, etc.)');
bullet('Ionicons', 'Renders icons throughout the app');
bullet('React Context API', 'Shares auth and theme state across all screens globally');

heading3('Admin Web Dashboard');
bullet('Next.js 16', 'Renders the dashboard pages with React');
bullet('TypeScript', 'Catches type errors at compile time');
bullet('Tailwind CSS', 'Styles every component using utility classes');
bullet('shadcn/ui', 'Provides ready-made components like dialogs, tables, and cards');
bullet('lucide-react', 'Renders icons across all dashboard pages');
bullet('next-themes', 'Toggles dark and light mode across the entire site');
bullet('axios', 'Sends API requests from the dashboard to the backend');

heading3('Services & Infrastructure');
bullet('Cloudinary', 'Hosts uploaded files and serves them via CDN link');
bullet('Expo Push Service', 'Delivers notifications to student devices');
bullet('PostgreSQL', 'Single source of truth for all data');
bullet('Node HTTPS', 'Calls the Expo Push API directly from the backend cron job');

// ─── SECTION 3: OVERVIEW ─────────────────────────────────────────────────────
doc.addPage();
heading2('System Overview');

heading3('Registration & Security');
plainText(
  '• Students can only register with college email IDs ending in @ycce.in\n' +
  '• The email prefix must match their roll number format\n' +
  '• New student accounts require admin approval before they can log in\n' +
  '• Passwords are stored as bcrypt hashes — never in plain text\n' +
  '• Every API request is protected with a JWT Bearer token'
);

heading3('Mobile App — Students & Faculty');
bullet('Subjects', 'Each student sees subjects for their year with 4 tabs: Announcements, Notes, Assignments, Attendance');
bullet('Announcements', 'Faculty post subject-specific announcements; students receive them under the subject');
bullet('Notes', 'Faculty upload PDFs with title and unit tag; students view and download directly');
bullet('Assignments', 'Faculty create assignments with due date and file; students submit notes or files');
bullet('Attendance', 'Students see per-subject attendance with a mini calendar (green = present, red = absent)');
bullet('Push Notifications', 'Students get alerts 15 min before class and 24 hours before assignment deadline');

heading3('Admin Web Dashboard — Professors & Admins');
bullet('Overview', 'Live stats cards (Total Students, Approved, Pending, Announcements) — each clickable to expand full list');
bullet('Users', 'Approve or reject student registrations; view all students in a table');
bullet('Announcements', 'Post general or year-specific announcements with type badge');
bullet('Attendance', 'Mark attendance per subject per date with calendar view, search bar, and bulk P/A buttons');
bullet('Results', 'Add or update SGPA per student per semester with auto-filled semester and academic year');
bullet('Timetable', 'Add lectures with custom subject name, day, time, and room — filtered by year');
bullet('Assignments', 'Create assignments with file attachment; view all student submissions per assignment');
bullet('Faculty', 'View all faculty accounts with name, email, and role');
bullet('Dark / Light Mode', 'Toggle in the sidebar footer');

// ─── SECTION 4: NOTIFICATIONS ────────────────────────────────────────────────
heading2('Notification System');
tableRow('Trigger', 'Recipients', 'Message', true);
tableRow('15 min before lecture', 'Students of that year', '"Subject starts in 15 minutes"');
tableRow('Lecture starts now', 'Students of that year', '"Your lecture has begun"');
tableRow('24 hrs before deadline', 'Students who have not submitted', '"Assignment due tomorrow"');

// ─── SECTION 5: DATABASE ─────────────────────────────────────────────────────
heading2('Database Tables (PostgreSQL)');
plainText(
  'users · subjects · assignments · assignment_submissions · attendance · ' +
  'timetable · announcements · notes · sgpa_results · notification_logs'
);
plainText(
  'All relationships use foreign keys. Unique constraints prevent duplicate attendance records and submissions. ' +
  'Upsert (ON CONFLICT DO UPDATE) is used for attendance and SGPA so re-submitting updates the existing record.'
);

// ─── SECTION 6: KEY PATTERNS ─────────────────────────────────────────────────
heading2('Key Architectural Patterns');
bullet('REST API', 'All communication between frontend and backend uses HTTP endpoints');
bullet('JWT Auth', 'Every protected route validates the Bearer token before responding');
bullet('Role-based Access', 'Students, professors, and admins each get different data and permissions');
bullet('Multipart/form-data', 'Sends files alongside text in a single HTTP request');
bullet('Cron Jobs', 'Automatically notify students without any manual trigger');
bullet('Upsert Pattern', 'Updates existing records instead of throwing errors for duplicates');

// ─── FOOTER ──────────────────────────────────────────────────────────────────
doc.moveDown(2);
doc.fontSize(8).font('Helvetica').fillColor(LIGHT)
  .text('YCCE — Computer Technology Department · Confidential', { align: 'center' });

doc.end();
console.log('PDF generated:', out);
