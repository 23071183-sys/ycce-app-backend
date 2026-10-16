const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { adminOnly, superAdminOnly } = require('../middleware/roles');
const ai = require('../config/ai');

// App-wide switches. Admins can see them; only super_admin can change them.
router.use(authMiddleware);

// Which AI provider the study tools use, and whether each one has a key.
router.get('/ai', adminOnly, async (req, res) => {
  try {
    res.json(await ai.status());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Body: { provider?, gemini_model? } — gemini_model null means automatic.
router.put('/ai', superAdminOnly, async (req, res) => {
  const { provider, gemini_model } = req.body || {};
  const changes = {};
  try {
    const st = await ai.status();
    if (provider !== undefined) {
      if (!ai.PROVIDERS.includes(provider)) return res.status(400).json({ error: 'provider must be anthropic or gemini' });
      if (!st.providers[provider].configured) {
        return res.status(409).json({ error: `${provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} is not set on the server` });
      }
      changes.provider = provider;
    }
    if (gemini_model !== undefined) {
      if (gemini_model !== null && !(await ai.geminiAvailable()).includes(gemini_model)) {
        return res.status(400).json({ error: 'That Gemini model is not available for this key' });
      }
      changes.gemini_model = gemini_model;
    }
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to change' });
    await ai.saveSettings(changes, req.user.userId);
    res.json(await ai.status());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Make one small call with the chosen provider and report how it went.
router.post('/ai/test', superAdminOnly, async (req, res) => {
  // ?tool=quiz|cards|plan runs the real schema of that feature instead of a tiny one.
  const tools = require('../controllers/studyAiController')._internal;
  const tool = { quiz: tools.QUIZ_TOOL, cards: tools.CARDS_TOOL, plan: tools.PLAN_TOOL }[req.query.tool] || null;
  res.json(await ai.test(tool));
});

module.exports = router;
