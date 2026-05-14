const pool = require('../config/database');

const faculty = [
  {
    email: 'kavita.singh@ycce.edu',
    real_email: 'ksingh@ycce.edu',
    teaching_exp: '16 Years', industrial_exp: '1 Year', research_count: '50+',
    courses_taught: 'DBMS, Data Structures, Machine Learning, Computer Vision, Information Retrieval System, Pattern Recognition, Geographical Information System',
  },
  {
    email: 'manali.kshirsagar@ycce.edu',
    real_email: 'manali_kshirsagar@yahoo.com',
    teaching_exp: '30 Years', industrial_exp: '—', research_count: '75+',
    courses_taught: 'Introduction to Salesforce, Data Mining, DBMS, Operating Systems',
  },
  {
    email: 'arvind.bhagatpatil@ycce.edu',
    real_email: 'arbhagatpatil@ycce.edu',
    teaching_exp: '31 Years', industrial_exp: '1 Year', research_count: '75',
    courses_taught: 'Cyber Forensics, Network Security, Cryptography, Distributed Systems, Computer Networks, IoT, AI/ML, Operating Systems, Digital Electronics',
  },
  {
    email: 'shivkumar.karale@ycce.edu',
    real_email: 'sjkarale@ycce.edu',
    teaching_exp: '28 Years', industrial_exp: '1 Year', research_count: '—',
    courses_taught: 'Algorithms, Language Processors, Data Structures',
  },
  {
    email: 'gauri.dhopavkar@ycce.edu',
    real_email: 'gmdhopavkar@ycce.edu',
    teaching_exp: '21 Years', industrial_exp: '2 Years', research_count: '—',
    courses_taught: 'Artificial Intelligence, Natural Language Processing, Semantic Web, Operating Systems, Computer Architecture and Organization, Software Architecture',
  },
  {
    email: 'rakhi.wajgi@ycce.edu',
    real_email: 'rdwajgi@ycce.edu',
    teaching_exp: '14 Years', industrial_exp: '0.5 Year', research_count: '20+',
    courses_taught: 'Foundations of Data Science, Data Structures, Algorithms, Operating Systems, Parallel Computing, Advanced Data Structures',
  },
  {
    email: 'smita.kapse@ycce.edu',
    real_email: 'smitarkapse@ycce.edu',
    teaching_exp: '18 Years', industrial_exp: '—', research_count: '27',
    courses_taught: 'Computer Networks, Network Security, IoT, Data Structures, Linux OS, Advanced Data Structures',
  },
  {
    email: 'roshni.khedgaonkar@ycce.edu',
    real_email: 'rskhedgaonkar@ycce.edu',
    teaching_exp: '14 Years', industrial_exp: '—', research_count: '20',
    courses_taught: 'CAO, OS, DAA, AI, Python, Digital Image Processing, Computer Vision, HPCA',
  },
  {
    email: 'gauri.chaudhary@ycce.edu',
    real_email: 'chaudhary_gauri@yahoo.com',
    teaching_exp: '9 Years', industrial_exp: '10 Years', research_count: '—',
    courses_taught: 'Data Mining, DBMS, Software Engineering, Web Technologies, Database Security',
  },
  {
    email: 'nilesh.sambhe@ycce.edu',
    real_email: 'nusambhe@ycce.edu',
    teaching_exp: '14 Years', industrial_exp: '1.5 Years', research_count: '27',
    courses_taught: 'Computer Networks, Network Security, Wireless Sensor Networks, Internet of Things',
  },
  {
    email: 'prarthana.deshkar@ycce.edu',
    real_email: 'padeshkar@ycce.edu',
    teaching_exp: '7 Years', industrial_exp: '5 Years', research_count: '—',
    courses_taught: 'OOP, DBMS, Business Intelligence, Statistical Data Analysis, Artificial Intelligence',
  },
  {
    email: 'praful.barekar@ycce.edu',
    real_email: 'praful.barekar20@gmail.com',
    teaching_exp: '13 Years', industrial_exp: '1 Year', research_count: '14',
    courses_taught: 'Digital Image Processing, Neural Network & Fuzzy Logic, Operating System, Advanced Data Structure, Soft Computing',
  },
  {
    email: 'supriya.thombre@ycce.edu',
    real_email: 'sthombre@ycce.edu',
    teaching_exp: '10.9 Years', industrial_exp: '—', research_count: '20',
    courses_taught: 'Operating Systems, Systems Programming, DBMS, High Performance Computer Architecture, Microprocessor Operating Systems',
  },
  {
    email: 'roshan.bhanuse@ycce.edu',
    real_email: 'rsbhanuse@ycce.edu',
    teaching_exp: '11 Years', industrial_exp: '1 Year', research_count: '—',
    courses_taught: 'Theory of Computation, Compiler Construction, DBMS',
  },
  {
    email: 'ganesh.yenurkar@ycce.edu',
    real_email: 'gkyenurkar@ycce.edu',
    teaching_exp: '13 Years', industrial_exp: '—', research_count: '—',
    courses_taught: 'Web Technology, Cyber Laws, Artificial Intelligence, CRM, Introduction to Salesforce, e-Commerce, Cloud Computing',
  },
  {
    email: 'sanjay.pande@ycce.edu',
    real_email: 'sppande@ycce.edu',
    teaching_exp: '23 Years', industrial_exp: '1 Year', research_count: '8',
    courses_taught: 'Data Communication and Networking, Computer Network, Computer Architecture, Basic Electronics, Digital Techniques',
  },
  {
    email: 'gendlal.vaidya@ycce.edu',
    real_email: 'gendlalvaidya@gmail.com',
    teaching_exp: '11.6 Years', industrial_exp: '—', research_count: '—',
    courses_taught: 'C, OOP, Data Structures, Java, Client Side Scripting, Operating System',
  },
  {
    email: 'shweta.gode@ycce.edu',
    real_email: 'shweta_amt80@rediffmail.com',
    teaching_exp: '9 Years', industrial_exp: '—', research_count: '—',
    courses_taught: 'Software Engineering, Mobile Communication, OOP, Cloud Computing',
  },
  {
    email: 'lata.tembhare@ycce.edu',
    real_email: 'latabopche111@gmail.com',
    teaching_exp: '7 Years', industrial_exp: '—', research_count: '3',
    courses_taught: 'Computer Networks, TCP/IP, Mobile Communication, Embedded Systems',
  },
  {
    email: 'prachi.bainalwar@ycce.edu',
    real_email: 'prachidussawar1987@gmail.com',
    teaching_exp: '6 Years', industrial_exp: '—', research_count: '2',
    courses_taught: 'C, C++, DBMS, Computer Architecture & Organization, Software Engineering, OOP',
  },
  {
    email: 'piyush.ingole@ycce.edu',
    real_email: 'piyush.ingole@ycce.edu',
    teaching_exp: '—', industrial_exp: '—', research_count: '—',
    courses_taught: '—',
  },
];

(async () => {
  for (const f of faculty) {
    await pool.query(
      `UPDATE users SET email=$1, teaching_exp=$2, industrial_exp=$3, courses_taught=$4, research_count=$5
       WHERE email=$6`,
      [f.real_email, f.teaching_exp, f.industrial_exp, f.courses_taught, f.research_count, f.email]
    );
  }
  console.log('✅ All 21 faculty details updated with real emails and profile data');
  process.exit();
})().catch(e => { console.error(e.message); process.exit(1); });
