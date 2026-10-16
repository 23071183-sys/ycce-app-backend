const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { adminOnly, staffOnly } = require('../middleware/roles');
const { upload } = require('../config/cloudinary');
const study = require('../controllers/studyController');
const aiStudy = require('../controllers/studyAiController');

router.use(authMiddleware);

// Past papers (professors for their subjects, admins for any)
router.get('/papers', study.listPapers);
router.post('/papers', staffOnly, upload.single('file'), study.uploadPaper);
router.get('/papers/:id/questions', study.paperQuestions);
router.post('/papers/:id/extract', staffOnly, study.retryExtract);
router.delete('/papers/:id', staffOnly, study.deletePaper);

// Exam schedule (admins edit)
router.get('/exams', study.listExams);
router.put('/exams', adminOnly, study.upsertExam);
router.delete('/exams/:id', adminOnly, study.deleteExam);

// Quiz, flashcards, planner
router.get('/quiz/:subjectId', aiStudy.getQuiz);
router.post('/quiz/:quizId/attempt', aiStudy.submitQuiz);
router.post('/flashcards/:subjectId/generate', aiStudy.generateCards);
router.get('/flashcards/due', aiStudy.dueCards);
router.post('/flashcards/:cardId/review', aiStudy.reviewCard);
router.get('/plan', aiStudy.getPlan);
router.post('/plan', aiStudy.generatePlan);

module.exports = router;
