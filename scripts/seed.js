require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🌱 Seeding database...\n');

    // -------------------------
    // USERS
    // -------------------------
    const password = await bcrypt.hash('test1234', 12);

    const usersResult = await client.query(`
      INSERT INTO users (name, email, password, role, year, roll_number, department) VALUES
        ('Dr. Anjali Deshmukh',  'anjali@ycce.edu',   $1, 'professor', NULL, NULL,       'Computer Technology'),
        ('Prof. Rajan Mehta',    'rajan@ycce.edu',    $1, 'professor', NULL, NULL,       'Computer Technology'),
        ('Prof. Sunita Patil',   'sunita@ycce.edu',   $1, 'professor', NULL, NULL,       'Computer Technology'),
        ('Admin User',           'admin@ycce.edu',    $1, 'super_admin', NULL, NULL,     'Computer Technology'),
        ('Arjun Kulkarni',       'arjun@ycce.edu',    $1, 'student',  1,    'CT23001',  'Computer Technology'),
        ('Priya Wankhede',       'priya@ycce.edu',    $1, 'student',  1,    'CT23002',  'Computer Technology'),
        ('Rohit Bhosale',        'rohit@ycce.edu',    $1, 'student',  2,    'CT22001',  'Computer Technology'),
        ('Sneha Joshi',          'sneha@ycce.edu',    $1, 'student',  2,    'CT22002',  'Computer Technology'),
        ('Aditya Nair',          'aditya@ycce.edu',   $1, 'student',  3,    'CT21001',  'Computer Technology'),
        ('Kavya Deshpande',      'kavya@ycce.edu',    $1, 'student',  3,    'CT21002',  'Computer Technology'),
        ('Nikhil Gawande',       'nikhil@ycce.edu',   $1, 'student',  4,    'CT20001',  'Computer Technology'),
        ('Pooja Thakare',        'pooja@ycce.edu',    $1, 'student',  4,    'CT20002',  'Computer Technology'),
        ('Fest Admin',           'fest@ycce.edu',     $1, 'fest_admin', NULL, NULL,     'Computer Technology')
      ON CONFLICT (email) DO NOTHING
      RETURNING id, name, role, year
    `, [password]);

    const users = usersResult.rows;
    const prof1  = users.find(u => u.name === 'Dr. Anjali Deshmukh');
    const prof2  = users.find(u => u.name === 'Prof. Rajan Mehta');
    const prof3  = users.find(u => u.name === 'Prof. Sunita Patil');
    const admin  = users.find(u => u.name === 'Admin User');

    console.log(`✅ Users seeded: ${users.length}`);

    // -------------------------
    // SUBJECTS
    // -------------------------
    const subjectsResult = await client.query(`
      INSERT INTO subjects (name, code, year, semester, professor_id, department) VALUES
        ('Engineering Mathematics III',   'CTM301', 3, 5, $1, 'Computer Technology'),
        ('Data Structures & Algorithms',  'CTD302', 3, 5, $2, 'Computer Technology'),
        ('Database Management Systems',   'CDB303', 3, 5, $3, 'Computer Technology'),
        ('Computer Networks',             'CCN304', 3, 6, $1, 'Computer Technology'),
        ('Operating Systems',             'COS305', 3, 6, $2, 'Computer Technology'),
        ('Web Technology',                'CWT201', 2, 3, $3, 'Computer Technology'),
        ('Object Oriented Programming',   'COP202', 2, 3, $1, 'Computer Technology'),
        ('Digital Electronics',           'CDE101', 1, 1, $2, 'Computer Technology'),
        ('Engineering Physics',           'CEP102', 1, 1, $3, 'Computer Technology'),
        ('Software Engineering',          'CSE401', 4, 7, $1, 'Computer Technology'),
        ('Machine Learning',              'CML402', 4, 7, $2, 'Computer Technology')
      ON CONFLICT DO NOTHING
      RETURNING id, name, code, year
    `, [prof1?.id, prof2?.id, prof3?.id]);

    const subjects = subjectsResult.rows;
    const yr3subjects = subjects.filter(s => s.year === 3);

    console.log(`✅ Subjects seeded: ${subjects.length}`);

    // -------------------------
    // TIMETABLE (Year 3)
    // -------------------------
    if (yr3subjects.length >= 3) {
      const [maths, dsa, dbms, cn, os] = yr3subjects;
      await client.query(`
        INSERT INTO timetable (subject_id, year, day, start_time, end_time, room) VALUES
          ($1, 3, 'Monday',    '09:00', '10:00', 'CT-301'),
          ($2, 3, 'Monday',    '10:00', '11:00', 'CT-301'),
          ($3, 3, 'Monday',    '11:15', '12:15', 'CT-301'),
          ($4, 3, 'Tuesday',   '09:00', '10:00', 'CT-301'),
          ($5, 3, 'Tuesday',   '10:00', '11:00', 'CT-301'),
          ($1, 3, 'Wednesday', '09:00', '10:00', 'CT-301'),
          ($2, 3, 'Wednesday', '11:15', '12:15', 'CT-302'),
          ($3, 3, 'Thursday',  '10:00', '11:00', 'CT-Lab'),
          ($4, 3, 'Friday',    '09:00', '10:00', 'CT-301'),
          ($5, 3, 'Friday',    '10:00', '11:00', 'CT-301')
        ON CONFLICT DO NOTHING
      `, [maths?.id, dsa?.id, dbms?.id, cn?.id, os?.id]);
      console.log('✅ Timetable seeded: 10 entries (Year 3)');
    }

    // -------------------------
    // ANNOUNCEMENTS
    // -------------------------
    if (admin && prof1 && prof2) {
      await client.query(`
        INSERT INTO announcements (title, content, type, year, posted_by) VALUES
          (
            'Welcome to Semester 5!',
            'Dear students, welcome back to the new semester. Classes begin on Monday. Please check your timetables and report to your respective classrooms on time. All the best for the semester ahead!',
            'general',
            NULL,
            $1
          ),
          (
            'Internal Exam Schedule Released',
            'The internal examination schedule for Semester 5 has been released. Unit Test 1 will be conducted from 15th to 20th of this month. Syllabus: First two units of each subject. Prepare well!',
            'general',
            NULL,
            $1
          ),
          (
            'DSA Assignment 1 Deadline Extended',
            'The deadline for Data Structures Assignment 1 (Linked List implementation) has been extended to this Friday. Please submit via the assignments portal. Late submissions will not be accepted after the new deadline.',
            'year_specific',
            3,
            $2
          ),
          (
            'DBMS Lab Cancelled Tomorrow',
            'The DBMS lab session scheduled for tomorrow (Thursday) stands cancelled due to a faculty meeting. The lab will be rescheduled. Students are advised to utilise the time for self-study.',
            'year_specific',
            3,
            $3
          ),
          (
            'Library Timings Extended',
            'The college library will now remain open till 8 PM on weekdays to support students during exam season. Make good use of the extended hours. Library cards are mandatory for entry.',
            'general',
            NULL,
            $1
          )
        ON CONFLICT DO NOTHING
      `, [admin.id, prof2.id, prof3.id]);
      console.log('✅ Announcements seeded: 5 entries');
    }

    // -------------------------
    // COMPUFEST EVENTS
    // -------------------------
    await client.query(`
      INSERT INTO compufest_events (title, description, event_date, venue, registration_link, is_active) VALUES
        (
          'Code Blitz',
          'A fast-paced competitive coding contest. Solve algorithmic problems under time pressure. Open to all years. Top 3 winners get cash prizes.',
          '2026-03-15 10:00:00',
          'CT Lab 1 & 2',
          'https://compufest.ycce.edu/register/code-blitz',
          true
        ),
        (
          'HackFest 24H',
          '24-hour hackathon to build innovative solutions for real-world problems. Team size: 2-4. Problem statements released at the start.',
          '2026-03-22 09:00:00',
          'Seminar Hall',
          'https://compufest.ycce.edu/register/hackfest',
          true
        ),
        (
          'Web Design Challenge',
          'Design and develop a responsive website in 3 hours. Judged on creativity, functionality, and code quality.',
          '2026-03-16 11:00:00',
          'CT Lab 3',
          'https://compufest.ycce.edu/register/webdesign',
          true
        ),
        (
          'Paper Presentation',
          'Present your research paper or innovative idea to a panel of judges. Individual or team of 2. Submit abstract 1 week before.',
          '2026-03-18 10:00:00',
          'Seminar Hall',
          'https://compufest.ycce.edu/register/paper',
          true
        )
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Compufest events seeded: 4 entries');

    // -------------------------
    // COMPUFEST COMMITTEE
    // -------------------------
    await client.query(`
      INSERT INTO compufest_committee (name, position, hierarchy_order, year, is_faculty_coordinator, contact) VALUES
        ('Dr. Anjali Deshmukh',  'Faculty Coordinator',    1, NULL, true,  '9876543210'),
        ('Nikhil Gawande',       'Chairperson',            2, 4,    false, '9876500001'),
        ('Pooja Thakare',        'Vice Chairperson',       3, 4,    false, '9876500002'),
        ('Aditya Nair',          'Technical Head',         4, 3,    false, '9876500003'),
        ('Kavya Deshpande',      'Events Coordinator',     5, 3,    false, '9876500004'),
        ('Rohit Bhosale',        'Marketing Head',         6, 2,    false, '9876500005'),
        ('Sneha Joshi',          'Design Head',            7, 2,    false, '9876500006')
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Compufest committee seeded: 7 members');

    // -------------------------
    // YASH FEST EVENTS
    // -------------------------
    await client.query(`
      INSERT INTO fest_events (title, description, event_date, venue, category, is_active) VALUES
        ('Battle of Bands',    'Inter-college band competition. Bring your instruments and rock the stage!',                    '2026-04-05 18:00:00', 'Open Air Theatre', 'Music',   true),
        ('Dance Fever',        'Solo and group dance competition across all styles — classical, western, and fusion.',          '2026-04-06 16:00:00', 'Main Stage',       'Dance',   true),
        ('Nukkad Natak',       'Street play competition on social themes. Teams of 8-12. Duration: 15-20 minutes.',           '2026-04-05 14:00:00', 'College Ground',   'Drama',   true),
        ('Photography Hunt',   'Capture the theme in 2 hours on campus. Submit your best 3 shots. Any camera allowed.',       '2026-04-06 10:00:00', 'Campus Wide',      'Art',     true),
        ('Debate Competition', 'Formal debate on current affairs. English and Hindi both allowed. Individual participation.',  '2026-04-07 10:00:00', 'Seminar Hall',     'Literary',true)
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Yash Fest events seeded: 5 entries');

    await client.query('COMMIT');
    console.log('\n🎉 All seed data inserted successfully!');
    console.log('\n📋 Test credentials (all use password: test1234)');
    console.log('   student   → aditya@ycce.edu');
    console.log('   professor → anjali@ycce.edu');
    console.log('   admin     → admin@ycce.edu');
    console.log('   fest_admin→ fest@ycce.edu');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
};

seed();
