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

router.put('/ai', superAdminOnly, async (req, res) => {
  const provider = req.body?.provider;
  if (!ai.PROVIDERS.includes(provider)) return res.status(400).json({ error: 'provider must be anthropic or gemini' });
  try {
    const st = await ai.status();
    if (!st.providers[provider].configured) {
      return res.status(409).json({ error: `${provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} is not set on the server` });
    }
    await ai.setProvider(provider, req.user.userId);
    res.json(await ai.status());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
