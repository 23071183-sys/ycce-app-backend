const pool = require('../config/database');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const ai = require('../config/ai');
const collegeSite = require('../config/collegeSite');
const chatMemory = require('../config/chatMemory');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── System prompts ────────────────────────────────────────────────────────────
const STUDENT_SYSTEM = `You are an AI assistant embedded in the YCCE (Yashwantrao Chavan College of Engineering) mobile app for the Computer Technology Department, Nagpur.

You have tools that give you LIVE access to every piece of data for the logged-in student — attendance, subjects, notes, assignments, submissions, results, CGPA, timetable, announcements, fest events, and more.

RULES:
- ALWAYS use a tool when the user asks about their own data. Never guess or make up values.
- If asked to generate a PDF, call generate_attendance_pdf.
- Keep responses concise and mobile-friendly. Use bullet points for lists.
- Highlight warnings: attendance < 75%, overdue assignments, failed subjects.
- For questions about the department's faculty (HOD, deans, professors, who teaches what, emails, qualifications), call get_faculty and answer from it. The HOD is whoever's designation says "HOD".
- Never answer facts about YCCE people or the college from memory. If no tool gives the answer, say you don't have that information rather than guessing.
- For questions unrelated to academics or YCCE, politely redirect.
${collegeSite.PROMPT_RULES}`;

const ADMIN_SYSTEM = `You are a developer assistant for the YCCE app backend. You are talking to the system admin who has full access.

You can read and write files in the backend project, run database queries, fetch live college data, and diagnose and fix issues.

PROJECT ROOT: ${PROJECT_ROOT}
KEY FILES:
- controllers/ — business logic
- routes/       — API route definitions
- middleware/   — auth, validation
- config/       — database, cloudinary, auth config
- scripts/      — migrate.js, seed.js
- server.js     — main entry point

DATA TOOLS (use these first for college data questions — faster and safer than raw SQL):
- get_professors          → all professors and their subjects
- get_students            → student list, filter by year
- get_attendance_report   → attendance across all subjects/students, filter by year or subject
- get_subject_attendance_summary → per-student attendance % for a specific subject (good for flagging low attendance)
- get_assignment_stats    → assignment submission counts and pending students per subject
- get_announcements       → all announcements posted by professors
- get_notes               → notes posted by professors, filter by subject or professor
- get_all_users           → every registered user with role info

RULES:
- For college data questions (attendance, professors, students, assignments, notes) always use the dedicated data tools — do not guess.
- When diagnosing a code issue, read the relevant file first before suggesting a fix.
- For DB issues not covered by data tools, use run_db_query.
- Be precise and concise — use tables or bullet lists for structured data.
- Never delete files. Never modify .env.
- After writing a file fix, remind the admin to restart the server.
${collegeSite.PROMPT_RULES}`;

// ─── Student tools ─────────────────────────────────────────────────────────────
// Shared by students and professors: the department's faculty directory.
const FACULTY_TOOL = {
  name: 'get_faculty',
  description: "The Computer Technology department's faculty: name, designation (e.g. HOD & Professor, Dean), qualification, email, experience, courses taught and the subjects they teach in this app. Use for any question about the HOD or other faculty.",
  input_schema: { type: 'object', properties: {}, required: [] },
};

const STUDENT_TOOLS = [
  FACULTY_TOOL,
  ...collegeSite.TOOLS,
  {
    name: 'get_my_profile',
    description: "Get the logged-in student's full profile: name, email, roll number, year, semester, department.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_subjects',
    description: "Get all subjects for the student's year — name, code, semester, professor name.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_attendance',
    description: "Get overall attendance summary across all subjects — present count, total classes, percentage.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_subject_attendance',
    description: "Get full date-wise attendance records for a specific subject.",
    input_schema: {
      type: 'object',
      properties: {
        subject_name: { type: 'string', description: 'Subject name (partial match OK)' },
      },
      required: ['subject_name'],
    },
  },
  {
    name: 'get_my_timetable',
    description: "Get the student's weekly class timetable — day, time, subject, room.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_assignments',
    description: "Get all assignments for the student's year — title, subject, due date, submitted or not.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_submissions',
    description: "Get all assignment submissions the student has made — content, file, submission time, grade, feedback.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_notes',
    description: "Get study notes available for the student, optionally filtered by subject.",
    input_schema: {
      type: 'object',
      properties: {
        subject_name: { type: 'string', description: 'Filter by subject name (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'get_announcements',
    description: "Get all announcements visible to the student — general, year-specific, and subject-specific.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_results',
    description: "Get the student's exam results — marks, grade, pass/fail per subject, plus SGPA and CGPA.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_compufest_info',
    description: "Get Compufest events and committee members.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_fest_info',
    description: "Get Yash Fest events and announcements.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generate_attendance_pdf',
    description: "Generate and return a downloadable PDF attendance report for the student.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

// ─── Admin tools ───────────────────────────────────────────────────────────────
const ADMIN_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of any file in the backend project. Use this to diagnose bugs before fixing them.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path relative to project root, e.g. "controllers/attendanceController.js"' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file in the backend project to apply a fix. Always read the file first.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path relative to project root' },
        content: { type: 'string', description: 'Full new content for the file' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and folders inside a directory of the project.',
    input_schema: {
      type: 'object',
      properties: {
        dir_path: { type: 'string', description: 'Path relative to project root, e.g. "controllers" or "routes"' },
      },
      required: ['dir_path'],
    },
  },
  {
    name: 'run_db_query',
    description: 'Run a SQL query against the database. Use SELECT for inspection, or INSERT/UPDATE/DELETE to fix data issues.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query to execute' },
        params: {
          type: 'array',
          description: 'Optional parameterised values (use $1, $2 in query)',
          items: { type: 'string' },
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_db_tables',
    description: 'List all tables in the database and their column names and types.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_all_users',
    description: 'Get a list of all registered users — name, email, role, year, roll number, created date.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_server_routes',
    description: 'Read server.js to see all mounted routes and middleware.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_professors',
    description: 'Get all professors with their designation (HOD, Dean, Professor…), qualification, subjects, subject codes and the year they teach.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_attendance_report',
    description: 'Get attendance data for all students across all subjects, or filtered by year or subject name.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'number', description: 'Filter by student year (1–4). Omit for all years.' },
        subject_name: { type: 'string', description: 'Filter by subject name (partial match). Omit for all subjects.' },
      },
      required: [],
    },
  },
  {
    name: 'get_students',
    description: 'Get all students with their year, semester, roll number, and email.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'number', description: 'Filter by year (1–4). Omit for all years.' },
      },
      required: [],
    },
  },
  {
    name: 'get_assignment_stats',
    description: 'Get assignments with submission counts and pending student lists, optionally filtered by subject.',
    input_schema: {
      type: 'object',
      properties: {
        subject_name: { type: 'string', description: 'Filter by subject name (partial match). Omit for all subjects.' },
      },
      required: [],
    },
  },
  {
    name: 'get_subject_attendance_summary',
    description: 'Get per-subject attendance percentage for every student — useful for spotting low-attendance students.',
    input_schema: {
      type: 'object',
      properties: {
        subject_name: { type: 'string', description: 'Subject name (partial match).' },
      },
      required: ['subject_name'],
    },
  },
  {
    name: 'get_announcements',
    description: 'Get all announcements posted by professors, optionally filtered by type (general, year_specific, subject_specific).',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type: general | year_specific | subject_specific. Omit for all.' },
      },
      required: [],
    },
  },
  {
    name: 'get_notes',
    description: 'Get all notes posted by professors, optionally filtered by subject or professor name.',
    input_schema: {
      type: 'object',
      properties: {
        subject_name: { type: 'string', description: 'Filter by subject name (partial match). Omit for all.' },
        professor_name: { type: 'string', description: 'Filter by professor name (partial match). Omit for all.' },
      },
      required: [],
    },
  },
  ...collegeSite.TOOLS,
];

// ─── Student tool execution ────────────────────────────────────────────────────
async function executeStudentTool(name, input, userId) {
  switch (name) {

    case 'get_faculty': {
      const r = await pool.query(
        `SELECT u.name, u.designation, u.qualification, u.email, u.teaching_exp, u.industrial_exp,
                u.courses_taught, u.research_count,
                COALESCE(json_agg(json_build_object('subject', s.name, 'code', s.code, 'year', s.year))
                  FILTER (WHERE s.id IS NOT NULL), '[]') AS subjects_in_app
         FROM users u LEFT JOIN subjects s ON s.professor_id = u.id
         WHERE u.role = 'professor' AND u.status = 'approved'
         GROUP BY u.id
         ORDER BY u.sort_order NULLS LAST, u.name`
      );
      return r.rows;
    }

    case 'get_my_profile': {
      const r = await pool.query(
        'SELECT name, email, roll_number, year, semester, department, created_at FROM users WHERE id = $1',
        [userId]
      );
      return r.rows[0] || {};
    }

    case 'get_my_subjects': {
      const r = await pool.query(
        `SELECT s.id, s.name, s.code, s.year, s.semester, u.name AS professor_name
         FROM subjects s
         LEFT JOIN users u ON s.professor_id = u.id
         WHERE s.year = (SELECT year FROM users WHERE id = $1)
         ORDER BY s.semester, s.name`,
        [userId]
      );
      return r.rows;
    }

    case 'get_my_attendance': {
      const r = await pool.query(
        `SELECT s.name AS subject_name, s.code,
                COUNT(a.*) FILTER (WHERE a.status = 'present') AS present_count,
                COUNT(a.*) AS total_count,
                ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0
                      / NULLIF(COUNT(a.*), 0), 2) AS percentage
         FROM subjects s
         LEFT JOIN attendance a ON s.id = a.subject_id AND a.student_id = $1
         WHERE s.year = (SELECT year FROM users WHERE id = $1)
         GROUP BY s.id, s.name, s.code ORDER BY s.name`,
        [userId]
      );
      return r.rows;
    }

    case 'get_subject_attendance': {
      const r = await pool.query(
        `SELECT a.date, a.status, s.name AS subject_name
         FROM attendance a
         JOIN subjects s ON s.id = a.subject_id
         WHERE a.student_id = $1 AND s.name ILIKE $2
         ORDER BY a.date DESC LIMIT 100`,
        [userId, `%${input.subject_name}%`]
      );
      return r.rows;
    }

    case 'get_my_timetable': {
      const r = await pool.query(
        `SELECT t.day, t.start_time, t.end_time, s.name AS subject_name, s.code, t.room
         FROM timetable t
         JOIN subjects s ON s.id = t.subject_id
         WHERE t.year = (SELECT year FROM users WHERE id = $1) AND t.is_active = true
         ORDER BY
           CASE t.day
             WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2
             WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4
             WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 ELSE 7
           END, t.start_time`,
        [userId]
      );
      return r.rows;
    }

    case 'get_my_assignments': {
      const r = await pool.query(
        `SELECT a.id, a.title, a.description, a.due_date, a.file_url, a.file_name,
                s.name AS subject_name,
                (SELECT COUNT(*) FROM assignment_submissions sub
                 WHERE sub.assignment_id = a.id AND sub.student_id = $1) AS submitted
         FROM assignments a
         JOIN subjects s ON s.id = a.subject_id
         WHERE s.year = (SELECT year FROM users WHERE id = $1)
         ORDER BY a.due_date ASC`,
        [userId]
      );
      return r.rows;
    }

    case 'get_my_submissions': {
      const r = await pool.query(
        `SELECT asub.content, asub.file_url, asub.file_name, asub.submitted_at,
                asub.grade, asub.feedback,
                a.title AS assignment_title, a.due_date, s.name AS subject_name
         FROM assignment_submissions asub
         JOIN assignments a ON asub.assignment_id = a.id
         JOIN subjects s ON a.subject_id = s.id
         WHERE asub.student_id = $1
         ORDER BY asub.submitted_at DESC`,
        [userId]
      );
      return r.rows;
    }

    case 'get_my_notes': {
      const hasFilter = !!input.subject_name;
      const r = await pool.query(
        `SELECT n.title, n.content, n.unit, n.file_url, n.file_name,
                n.created_at, u.name AS posted_by, s.name AS subject_name
         FROM notes n
         JOIN subjects s ON n.subject_id = s.id
         LEFT JOIN users u ON n.posted_by = u.id
         WHERE s.year = (SELECT year FROM users WHERE id = $1)
           ${hasFilter ? 'AND s.name ILIKE $2' : ''}
         ORDER BY s.name, n.unit ASC NULLS LAST, n.created_at DESC`,
        hasFilter ? [userId, `%${input.subject_name}%`] : [userId]
      );
      return r.rows;
    }

    case 'get_announcements': {
      const yr = await pool.query('SELECT year FROM users WHERE id = $1', [userId]);
      const year = yr.rows[0]?.year;
      const r = await pool.query(
        `SELECT a.title, a.content, a.type, a.created_at, a.is_cancelled,
                s.name AS subject_name, u.name AS posted_by
         FROM announcements a
         LEFT JOIN subjects s ON a.subject_id = s.id
         LEFT JOIN users u ON a.posted_by = u.id
         WHERE a.type = 'general'
            OR (a.type = 'year_specific' AND a.year = $1)
            OR (a.type = 'subject_specific' AND s.year = $1)
         ORDER BY a.created_at DESC LIMIT 50`,
        [year]
      );
      return r.rows;
    }

    case 'get_my_results': {
      const results = await pool.query(
        `SELECT r.semester, r.internal_marks, r.external_marks, r.total_marks,
                r.grade, r.result, r.academic_year,
                s.name AS subject_name, s.code
         FROM results r
         JOIN subjects s ON r.subject_id = s.id
         WHERE r.student_id = $1 ORDER BY r.semester ASC, s.name ASC`,
        [userId]
      );
      const sgpa = await pool.query(
        'SELECT semester, sgpa, academic_year FROM semester_gpa WHERE student_id = $1 ORDER BY semester ASC',
        [userId]
      );
      const sgpaList = sgpa.rows;
      const cgpa = sgpaList.length
        ? parseFloat((sgpaList.reduce((s, r) => s + parseFloat(r.sgpa), 0) / sgpaList.length).toFixed(2))
        : null;
      return { results: results.rows, sgpa: sgpaList, cgpa };
    }

    case 'get_compufest_info': {
      const events = await pool.query('SELECT title, description, event_date, venue, registration_link, is_active FROM compufest_events ORDER BY event_date ASC');
      const committee = await pool.query('SELECT name, position, hierarchy_order, contact, linkedin_url, is_faculty_coordinator FROM compufest_committee ORDER BY hierarchy_order ASC');
      return { events: events.rows, committee: committee.rows };
    }

    case 'get_fest_info': {
      const events = await pool.query('SELECT title, description, event_date, venue, category, registration_link, is_active FROM fest_events ORDER BY event_date ASC');
      const announcements = await pool.query(
        `SELECT fa.title, fa.content, fa.fest_type, fa.created_at, u.name AS posted_by
         FROM fest_announcements fa LEFT JOIN users u ON fa.posted_by = u.id
         ORDER BY fa.created_at DESC LIMIT 20`
      );
      return { events: events.rows, announcements: announcements.rows };
    }

    case 'generate_attendance_pdf': {
      const userRow = await pool.query('SELECT name, roll_number, year FROM users WHERE id = $1', [userId]);
      const attendance = await pool.query(
        `SELECT s.name AS subject_name,
                COUNT(a.*) FILTER (WHERE a.status = 'present') AS present_count,
                COUNT(a.*) AS total_count,
                ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0
                      / NULLIF(COUNT(a.*), 0), 2) AS percentage
         FROM subjects s
         LEFT JOIN attendance a ON s.id = a.subject_id AND a.student_id = $1
         WHERE s.year = (SELECT year FROM users WHERE id = $1)
         GROUP BY s.id, s.name ORDER BY s.name`,
        [userId]
      );

      const u = userRow.rows[0];
      const rows = attendance.rows;
      const tempDir = path.join(PROJECT_ROOT, 'temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const filename = `attendance_${userId}_${Date.now()}.pdf`;
      const filepath = path.join(tempDir, filename);

      await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const stream = fs.createWriteStream(filepath);
        doc.pipe(stream);

        doc.rect(0, 0, doc.page.width, 80).fill('#1a1a2e');
        doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
           .text('YCCE — Attendance Report', 50, 22, { align: 'center' });
        doc.fontSize(10).font('Helvetica')
           .text('Computer Technology Department · Nagpur', 50, 50, { align: 'center' });

        doc.fillColor('#000000').moveDown(2);
        const infoY = doc.y;
        doc.fontSize(11).font('Helvetica-Bold').text('Student Details', 50, infoY);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
        doc.moveDown(0.4).font('Helvetica').fontSize(10).fillColor('#333333');
        doc.text(`Name          :  ${u.name}`);
        doc.text(`Roll Number   :  ${u.roll_number || 'N/A'}`);
        doc.text(`Year          :  Year ${u.year}`);
        doc.text(`Generated On  :  ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
        doc.moveDown(1);

        const tableTop = doc.y;
        doc.rect(50, tableTop, 500, 22).fill('#1a1a2e');
        doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
        doc.text('Subject',     60, tableTop + 6, { width: 220 });
        doc.text('Present',    280, tableTop + 6, { width: 70, align: 'center' });
        doc.text('Total',      350, tableTop + 6, { width: 70, align: 'center' });
        doc.text('Percentage', 420, tableTop + 6, { width: 120, align: 'center' });

        let rowY = tableTop + 22;
        doc.font('Helvetica').fontSize(10);
        rows.forEach((r, i) => {
          const pct = parseFloat(r.percentage || 0);
          const isLow = pct < 75 && parseInt(r.total_count) > 0;
          doc.rect(50, rowY, 500, 20).fill(i % 2 === 0 ? '#f9f9f9' : '#ffffff');
          doc.fillColor(isLow ? '#cc0000' : '#222222');
          doc.text(r.subject_name,           60, rowY + 5, { width: 220 });
          doc.text(String(r.present_count), 280, rowY + 5, { width: 70, align: 'center' });
          doc.text(String(r.total_count),   350, rowY + 5, { width: 70, align: 'center' });
          doc.text(parseInt(r.total_count) > 0 ? `${pct}%` : 'N/A', 420, rowY + 5, { width: 120, align: 'center' });
          rowY += 20;
        });
        doc.rect(50, tableTop, 500, rowY - tableTop).lineWidth(0.5).strokeColor('#cccccc').stroke();
        doc.moveDown(1.5);
        doc.fontSize(8).fillColor('#999999')
           .text('* Red entries indicate attendance below 75%.', 50);
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
      });

      return { filename, url: `/api/chat/pdf/${filename}` };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Admin tool execution ──────────────────────────────────────────────────────
async function executeAdminTool(name, input, callerRole) {
  // Innermost guard — this function must never be reachable by non-admins
  if (!['super_admin', 'admin'].includes(callerRole)) {
    return { error: 'Unauthorized' };
  }
  switch (name) {

    case 'read_file': {
      const safePath = path.resolve(PROJECT_ROOT, input.file_path);
      if (!safePath.startsWith(PROJECT_ROOT)) return { error: 'Access denied: path outside project' };
      if (!fs.existsSync(safePath)) return { error: `File not found: ${input.file_path}` };
      const content = fs.readFileSync(safePath, 'utf8');
      return { file_path: input.file_path, content };
    }

    case 'write_file': {
      const safePath = path.resolve(PROJECT_ROOT, input.file_path);
      if (!safePath.startsWith(PROJECT_ROOT)) return { error: 'Access denied: path outside project' };
      // Protect critical files
      const blocked = ['.env', 'package.json', 'package-lock.json'];
      if (blocked.includes(path.basename(input.file_path))) {
        return { error: `Writing to ${input.file_path} is not allowed for safety.` };
      }
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(safePath, input.content, 'utf8');
      return { success: true, file_path: input.file_path, message: 'File written. Restart the server to apply changes.' };
    }

    case 'list_directory': {
      const safePath = path.resolve(PROJECT_ROOT, input.dir_path || '');
      if (!safePath.startsWith(PROJECT_ROOT)) return { error: 'Access denied' };
      if (!fs.existsSync(safePath)) return { error: `Directory not found: ${input.dir_path}` };
      const entries = fs.readdirSync(safePath, { withFileTypes: true }).map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      }));
      return { dir_path: input.dir_path, entries };
    }

    case 'run_db_query': {
      // Block destructive schema changes
      const lower = input.query.toLowerCase().trim();
      const forbidden = ['drop table', 'drop database', 'truncate', 'alter table'];
      if (forbidden.some(f => lower.includes(f))) {
        return { error: 'That query type is blocked for safety. Use INSERT/UPDATE/DELETE for data fixes.' };
      }
      // Direct messages are private between their participants.
      if (/\b(messages|conversations|conversation_participants|chat_messages|chat_memories)\b/.test(lower)) {
        return { error: 'Direct messages are private and cannot be queried.' };
      }
      const r = await pool.query(input.query, input.params || []);
      return { rows: r.rows, rowCount: r.rowCount };
    }

    case 'get_db_tables': {
      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`
      );
      const result = {};
      for (const { table_name } of tables.rows) {
        const cols = await pool.query(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_name = $1 ORDER BY ordinal_position`,
          [table_name]
        );
        result[table_name] = cols.rows;
      }
      return result;
    }

    case 'get_all_users': {
      const r = await pool.query(
        `SELECT id, name, email, role, year, roll_number, department, created_at
         FROM users ORDER BY role, year, name`
      );
      return r.rows;
    }

    case 'get_server_routes': {
      const safePath = path.join(PROJECT_ROOT, 'server.js');
      const content = fs.readFileSync(safePath, 'utf8');
      return { content };
    }

    case 'get_professors': {
      const r = await pool.query(
        `SELECT u.id, u.name, u.email, u.department, u.designation, u.qualification,
                COALESCE(json_agg(json_build_object('subject', s.name, 'code', s.code, 'year', s.year) ORDER BY s.year, s.name)
                  FILTER (WHERE s.id IS NOT NULL), '[]') AS subjects
         FROM users u
         LEFT JOIN subjects s ON s.professor_id = u.id
         WHERE u.role = 'professor'
         GROUP BY u.id
         ORDER BY u.sort_order NULLS LAST, u.name`
      );
      return r.rows;
    }

    case 'get_attendance_report': {
      let where = '';
      const params = [];
      if (input.year) { params.push(input.year); where += ` AND u.year = $${params.length}`; }
      if (input.subject_name) { params.push(`%${input.subject_name}%`); where += ` AND s.name ILIKE $${params.length}`; }
      const r = await pool.query(
        `SELECT u.name AS student_name, u.roll_number, u.year,
                s.name AS subject_name,
                COUNT(a.*) FILTER (WHERE a.status = 'present') AS present,
                COUNT(a.*) AS total,
                ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(a.*), 0), 1) AS percentage
         FROM users u
         JOIN subjects s ON s.year = u.year
         LEFT JOIN attendance a ON a.student_id = u.id AND a.subject_id = s.id
         WHERE u.role = 'student' ${where}
         GROUP BY u.id, u.name, u.roll_number, u.year, s.id, s.name
         ORDER BY u.year, u.name, s.name`,
        params
      );
      return r.rows;
    }

    case 'get_students': {
      const params = [];
      const where = input.year ? (params.push(input.year), `AND year = $1`) : '';
      const r = await pool.query(
        `SELECT id, name, email, roll_number, year, semester, department, created_at
         FROM users WHERE role = 'student' ${where} ORDER BY year, name`,
        params
      );
      return r.rows;
    }

    case 'get_assignment_stats': {
      const params = [];
      const where = input.subject_name ? (params.push(`%${input.subject_name}%`), `AND s.name ILIKE $1`) : '';
      const r = await pool.query(
        `SELECT a.id, a.title, a.due_date, s.name AS subject_name,
                prof.name AS professor_name,
                COUNT(DISTINCT sub.student_id) AS submitted_count,
                COUNT(DISTINCT st.id) AS total_students,
                COUNT(DISTINCT st.id) - COUNT(DISTINCT sub.student_id) AS pending_count
         FROM assignments a
         JOIN subjects s ON s.id = a.subject_id
         LEFT JOIN users prof ON prof.id = s.professor_id
         LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id
         LEFT JOIN users st ON st.role = 'student' AND st.year = s.year
         WHERE 1=1 ${where}
         GROUP BY a.id, a.title, a.due_date, s.name, prof.name
         ORDER BY a.due_date DESC`,
        params
      );
      return r.rows;
    }

    case 'get_subject_attendance_summary': {
      const r = await pool.query(
        `SELECT u.name AS student_name, u.roll_number, u.year,
                s.name AS subject_name,
                COUNT(a.*) FILTER (WHERE a.status = 'present') AS present,
                COUNT(a.*) AS total,
                ROUND(COUNT(a.*) FILTER (WHERE a.status = 'present') * 100.0 / NULLIF(COUNT(a.*), 0), 1) AS percentage
         FROM subjects s
         JOIN users u ON u.year = s.year AND u.role = 'student'
         LEFT JOIN attendance a ON a.subject_id = s.id AND a.student_id = u.id
         WHERE s.name ILIKE $1
         GROUP BY u.id, u.name, u.roll_number, u.year, s.name
         ORDER BY percentage ASC NULLS LAST`,
        [`%${input.subject_name}%`]
      );
      return r.rows;
    }

    case 'get_announcements': {
      const params = [];
      const where = input.type ? (params.push(input.type), `AND a.type = $1`) : '';
      const r = await pool.query(
        `SELECT a.id, a.title, a.content, a.type, a.year, a.is_cancelled, a.created_at,
                u.name AS posted_by, s.name AS subject_name
         FROM announcements a
         LEFT JOIN users u ON u.id = a.posted_by
         LEFT JOIN subjects s ON s.id = a.subject_id
         WHERE 1=1 ${where}
         ORDER BY a.created_at DESC LIMIT 100`,
        params
      );
      return r.rows;
    }

    case 'get_notes': {
      const params = [];
      const conditions = [];
      if (input.subject_name) { params.push(`%${input.subject_name}%`); conditions.push(`s.name ILIKE $${params.length}`); }
      if (input.professor_name) { params.push(`%${input.professor_name}%`); conditions.push(`u.name ILIKE $${params.length}`); }
      const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';
      const r = await pool.query(
        `SELECT n.id, n.title, n.content, n.unit, n.file_url, n.file_name, n.created_at,
                s.name AS subject_name, u.name AS posted_by
         FROM notes n
         JOIN subjects s ON s.id = n.subject_id
         LEFT JOIN users u ON u.id = n.posted_by
         WHERE 1=1 ${where}
         ORDER BY n.created_at DESC LIMIT 200`,
        params
      );
      return r.rows;
    }

    default:
      return { error: `Unknown admin tool: ${name}` };
  }
}

// ─── Shared agentic loop ───────────────────────────────────────────────────────
async function runAgentLoop(system, tools, initialMessages, executeTool) {
  let apiMessages = [...initialMessages];
  // Uses whichever AI provider the super admin chose (Claude or Gemini).
  let response = await ai.chatTurn({ system, messages: apiMessages, tools });

  // Cap the tool rounds so a confused model can't loop forever.
  for (let round = 0; response.stop_reason === 'tool_use' && round < 8; round++) {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const tu of toolUseBlocks) {
      // The official-website tools are the same for every chat.
      const result = (await collegeSite.runTool(tu.name, tu.input)) ?? await executeTool(tu.name, tu.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }

    apiMessages = [
      ...apiMessages,
      { role: 'assistant', content: response.content },
      { role: 'user',      content: toolResults },
    ];

    response = await ai.chatTurn({ system, messages: apiMessages, tools });
  }

  return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || 'Done.';
}

// AI errors (no credits, quota, provider down) carry a message fit to show.
const aiFailure = (res, label, e) => {
  console.error(`${label} error:`, e.message, e.detail || '');
  if (e.status === 503) return res.status(503).json({ error: e.message });
  res.status(500).json({ error: 'AI service unavailable' });
};

// ─── Dashboard tools (read-only data, no files, no DB writes) ─────────────────
const DASHBOARD_TOOLS = [
  ADMIN_TOOLS.find(t => t.name === 'get_professors'),
  ADMIN_TOOLS.find(t => t.name === 'get_students'),
  ADMIN_TOOLS.find(t => t.name === 'get_attendance_report'),
  ADMIN_TOOLS.find(t => t.name === 'get_subject_attendance_summary'),
  ADMIN_TOOLS.find(t => t.name === 'get_assignment_stats'),
  ADMIN_TOOLS.find(t => t.name === 'get_announcements'),
  ADMIN_TOOLS.find(t => t.name === 'get_notes'),
  ADMIN_TOOLS.find(t => t.name === 'get_all_users'),
  ADMIN_TOOLS.find(t => t.name === 'get_db_tables'),
  ...collegeSite.TOOLS,
].filter(Boolean);

const DASHBOARD_SYSTEM = `You are a helpful assistant for the YCCE (Yashwantrao Chavan College of Engineering) admin portal. You help professors and admins view college data.

You have read-only access to live college data — professors, students, attendance, assignments, announcements, and notes.

RULES:
- Only fetch and display data. Never suggest modifications.
- You cannot read or write files, run raw SQL, or make changes to any data.
- Keep responses concise and well-formatted. Use tables or bullet lists for data.
- For faculty questions (HOD, deans, who teaches what) use get_professors; the HOD is whoever's designation says "HOD".
- Never answer facts about YCCE people or the college from memory; if no tool gives the answer, say so instead of guessing.
- For questions unrelated to YCCE college data, politely redirect.
${collegeSite.PROMPT_RULES}`;

exports.dashboardChat = async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const callerRole = req.user.role;
  if (!['super_admin', 'admin', 'professor'].includes(callerRole)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const reply = await runAgentLoop(DASHBOARD_SYSTEM, DASHBOARD_TOOLS, messages, async (name, input) => {
      // Only allow read-only admin tools — hard block anything not in DASHBOARD_TOOLS
      const allowed = DASHBOARD_TOOLS.map(t => t.name);
      if (!allowed.includes(name)) return { error: 'This action is not permitted in the dashboard chat.' };
      return await executeAdminTool(name, input, 'admin');
    });
    res.json({ reply });
  } catch (e) {
    aiFailure(res, 'Dashboard chat', e);
  }
};

// ─── Student / Professor chat (no file access) ─────────────────────────────────
// History rows as model messages: starts with the user and never has two
// turns from the same side in a row (some providers reject that).
function toModelMessages(rows) {
  const out = [];
  for (const r of rows) {
    if (!out.length && r.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === r.role) last.content += `\n\n${r.content}`;
    else out.push({ role: r.role, content: r.content });
  }
  return out;
}

exports.chat = async (req, res) => {
  const { messages, message } = req.body || {};
  const userId   = req.user.userId;
  const userRole = req.user.role;

  // Hard block — file tools never available here, no matter what
  if (['super_admin', 'admin'].includes(userRole)) {
    return res.status(403).json({ error: 'Admins must use /api/chat/admin' });
  }

  // { message } is the saved conversation with memory; { messages } is the
  // older stateless form, kept for app builds that haven't updated yet.
  const persistent = typeof message === 'string';
  if (persistent ? !message.trim() : !Array.isArray(messages)) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (persistent && message.length > 4000) {
    return res.status(400).json({ error: 'Message is too long (4000 characters max)' });
  }

  const baseTools = userRole === 'student' ? STUDENT_TOOLS : [FACULTY_TOOL, ...collegeSite.TOOLS];

  try {
    let pdfUrl = null;
    const saved = [];
    let system = STUDENT_SYSTEM;
    let tools = baseTools;
    let convo = messages;

    if (persistent) {
      const [memories, history] = await Promise.all([
        chatMemory.listMemories(userId),
        chatMemory.loadHistory(userId),
      ]);
      system = STUDENT_SYSTEM + chatMemory.memoryPrompt(memories);
      tools = [...baseTools, ...chatMemory.TOOLS];
      convo = toModelMessages([...history, { role: 'user', content: message.trim() }]);
    }

    const reply = await runAgentLoop(system, tools, convo, async (name, input) => {
      if (persistent) {
        const mem = await chatMemory.runTool(userId, name, input, saved);
        if (mem) return mem;
      }
      const result = await executeStudentTool(name, input, userId);
      if (name === 'generate_attendance_pdf' && result.url) pdfUrl = result.url;
      return result;
    });

    if (persistent) {
      await chatMemory.appendMessages(userId, [
        { role: 'user', content: message.trim() },
        { role: 'assistant', content: reply, pdf_url: pdfUrl, memory_note: saved.length ? saved.join(' · ') : null },
      ]);
    }
    res.json({ reply, pdf_url: pdfUrl, ...(persistent ? { memory_saved: saved } : {}) });
  } catch (e) {
    aiFailure(res, 'Chat', e);
  }
};

// The signed-in user's saved conversation and memories.
exports.getHistory = async (req, res) => {
  try {
    res.json({ messages: await chatMemory.loadHistory(req.user.userId, 100) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.clearHistory = async (req, res) => {
  try {
    await chatMemory.clearHistory(req.user.userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getMemories = async (req, res) => {
  try {
    res.json({ memories: await chatMemory.listMemories(req.user.userId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.deleteMemory = async (req, res) => {
  try {
    if (!(await chatMemory.deleteMemory(req.user.userId, req.params.id))) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ─── Admin developer chat (file + DB access) ───────────────────────────────────
exports.adminChat = async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Third layer — belt and suspenders: middleware already checked, but verify again
  if (!['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const reply = await runAgentLoop(ADMIN_SYSTEM, ADMIN_TOOLS, messages, async (name, input) => {
      return await executeAdminTool(name, input, req.user.role);
    });

    res.json({ reply });
  } catch (e) {
    aiFailure(res, 'Admin chat', e);
  }
};

// ─── Serve generated PDF ───────────────────────────────────────────────────────
exports.servePdf = (req, res) => {
  const { filename } = req.params;
  if (!/^[\w\-]+\.pdf$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filepath = path.join(PROJECT_ROOT, 'temp', filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'PDF not found or expired' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  fs.createReadStream(filepath).pipe(res);
};
