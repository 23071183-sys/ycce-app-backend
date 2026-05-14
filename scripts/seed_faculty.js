const pool = require('../config/database');
const bcrypt = require('bcryptjs');

// Exact data from YCCE website, in hierarchy order
const faculty = [
  { sort: 1,  name: 'Dr. Kavita R. Singh',        designation: 'HoD & Professor',                              qualification: 'Ph.D',                      joining: '2008-06-02', email: 'kavita.singh@ycce.edu' },
  { sort: 2,  name: 'Dr. Manali M. Kshirsagar',   designation: 'Professor',                                    qualification: 'Ph.D',                      joining: '2020-01-01', email: 'manali.kshirsagar@ycce.edu' },
  { sort: 3,  name: 'Dr. Arvind R. Bhagat Patil', designation: 'Dean (P&D) & Director (IQAC)',                 qualification: 'PhD (Computer Science & Technology)', joining: '2008-06-30', email: 'arvind.bhagatpatil@ycce.edu' },
  { sort: 4,  name: 'Dr. Shivkumar J. Karale',    designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2007-06-25', email: 'shivkumar.karale@ycce.edu' },
  { sort: 5,  name: 'Dr. Gauri M. Dhopavkar',     designation: 'Assistant Professor, I/C Centre of Excellence AI & ML', qualification: 'Ph.D',             joining: '2008-12-03', email: 'gauri.dhopavkar@ycce.edu' },
  { sort: 6,  name: 'Dr. Rakhi D. Wajgi',         designation: 'Assistant Professor, Dean (T&P)',              qualification: 'Ph.D',                      joining: '2008-12-15', email: 'rakhi.wajgi@ycce.edu' },
  { sort: 7,  name: 'Dr. Smita R. Kapse',         designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2010-07-02', email: 'smita.kapse@ycce.edu' },
  { sort: 8,  name: 'Dr. Roshni S. Khedgaonkar',  designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2008-08-28', email: 'roshni.khedgaonkar@ycce.edu' },
  { sort: 9,  name: 'Dr. Gauri A. Chaudhary',     designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2010-05-03', email: 'gauri.chaudhary@ycce.edu' },
  { sort: 10, name: 'Nilesh U. Sambhe',            designation: 'Assistant Professor',                          qualification: 'M.Tech.',                   joining: '2009-06-12', email: 'nilesh.sambhe@ycce.edu' },
  { sort: 11, name: 'Dr. Prarthana A. Deshkar',   designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2012-07-11', email: 'prarthana.deshkar@ycce.edu' },
  { sort: 12, name: 'Dr. Praful V. Barekar',      designation: 'Assistant Professor',                          qualification: 'M.Tech',                    joining: '2015-05-13', email: 'praful.barekar@ycce.edu' },
  { sort: 13, name: 'Dr. Supriya S. Thombre',     designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2009-12-09', email: 'supriya.thombre@ycce.edu' },
  { sort: 14, name: 'Roshan S. Bhanuse',           designation: 'Assistant Professor',                          qualification: 'M.Tech.',                   joining: '2011-06-29', email: 'roshan.bhanuse@ycce.edu' },
  { sort: 15, name: 'Dr. Ganesh K. Yenurkar',     designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2013-07-09', email: 'ganesh.yenurkar@ycce.edu' },
  { sort: 16, name: 'Dr. Sanjay P. Pande',        designation: 'Assistant Professor',                          qualification: 'M.Tech',                    joining: '2020-09-07', email: 'sanjay.pande@ycce.edu' },
  { sort: 17, name: 'Dr. Gendlal M. Vaidya',      designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2020-09-01', email: 'gendlal.vaidya@ycce.edu' },
  { sort: 18, name: 'Shweta A. Gode',              designation: 'Assistant Professor',                          qualification: 'M.E.',                      joining: '2023-03-23', email: 'shweta.gode@ycce.edu' },
  { sort: 19, name: 'Lata R. Tembhare',            designation: 'Assistant Professor',                          qualification: 'M.Tech.',                   joining: '2022-07-15', email: 'lata.tembhare@ycce.edu' },
  { sort: 20, name: 'Prachi A. Bainalwar',         designation: 'Assistant Professor',                          qualification: 'M.E.',                      joining: '2022-10-17', email: 'prachi.bainalwar@ycce.edu' },
  { sort: 21, name: 'Dr. Piyush K. Ingole',       designation: 'Assistant Professor',                          qualification: 'Ph.D',                      joining: '2024-08-31', email: 'piyush.ingole@ycce.edu' },
];

async function run() {
  const password = await bcrypt.hash('faculty123', 10);

  // Remove old incorrect faculty entries (keep fake test professors linked to subjects)
  await pool.query(
    `DELETE FROM users WHERE role = 'professor' AND email NOT IN ('anjali@ycce.edu', 'rajan@ycce.edu', 'sunita@ycce.edu')`
  );
  console.log('Old faculty cleared');

  for (const f of faculty) {
    await pool.query(
      `INSERT INTO users (name, email, password, role, department, designation, qualification, joining_date, sort_order)
       VALUES ($1, $2, $3, 'professor', 'Computer Technology', $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE
       SET name=$1, designation=$4, qualification=$5, joining_date=$6, sort_order=$7`,
      [f.name, f.email, password, f.designation, f.qualification, f.joining, f.sort]
    );
  }

  console.log(`✅ ${faculty.length} faculty inserted/updated in hierarchy order`);
  process.exit();
}

run().catch(e => { console.error(e.message); process.exit(1); });
