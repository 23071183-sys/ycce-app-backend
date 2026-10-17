const pool = require('./database');

// The in-app assistant's memory: the saved conversation (so it survives
// leaving the screen, reinstalling, or changing phones) and the facts a user
// explicitly asked it to remember, which go into every later chat.

const CONTEXT_MESSAGES = 30;  // sent to the model each turn
const KEEP_MESSAGES = 200;    // stored per user
const MAX_MEMORIES = 50;

async function loadHistory(userId, limit = CONTEXT_MESSAGES) {
  const { rows } = await pool.query(
    `SELECT id, role, content, pdf_url, memory_note, created_at FROM chat_messages
     WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.reverse();
}

async function appendMessages(userId, messages) {
  for (const m of messages) {
    await pool.query(
      `INSERT INTO chat_messages (user_id, role, content, pdf_url, memory_note) VALUES ($1, $2, $3, $4, $5)`,
      [userId, m.role, String(m.content).slice(0, 20000), m.pdf_url || null, m.memory_note || null]
    );
  }
  await pool.query(
    `DELETE FROM chat_messages WHERE user_id = $1 AND id < (
       SELECT MIN(id) FROM (SELECT id FROM chat_messages WHERE user_id = $1 ORDER BY id DESC LIMIT $2) newest)`,
    [userId, KEEP_MESSAGES]
  );
}

const clearHistory = (userId) => pool.query('DELETE FROM chat_messages WHERE user_id = $1', [userId]);

async function listMemories(userId) {
  const { rows } = await pool.query(
    'SELECT id, content, created_at FROM chat_memories WHERE user_id = $1 ORDER BY id', [userId]
  );
  return rows;
}

// Things that must never be kept, whatever the user asks.
const SECRET = /\b(password|passcode|pass\s*word|pwd|otp|one[-\s]?time|pin\b|cvv|card\s*(no|number))\b|\b\d{12,19}\b|\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/i;

async function addMemory(userId, raw) {
  const content = String(raw || '').replace(/\s+/g, ' ').trim();
  if (content.length < 3) return { error: 'Nothing to remember' };
  if (content.length > 300) return { error: 'Too long to remember — keep it under 300 characters' };
  if (SECRET.test(content)) return { error: "I can't save passwords, OTPs, PINs or card numbers. Keep those private." };
  const existing = await listMemories(userId);
  const dup = existing.find(m => m.content.toLowerCase() === content.toLowerCase());
  if (dup) return { saved: false, already: true, id: dup.id, content: dup.content };
  if (existing.length >= MAX_MEMORIES) {
    return { error: `Memory is full (${MAX_MEMORIES} items). Ask me to forget something first, or delete items under Memories.` };
  }
  const { rows: [m] } = await pool.query(
    'INSERT INTO chat_memories (user_id, content) VALUES ($1, $2) RETURNING id, content', [userId, content]
  );
  return { saved: true, id: m.id, content: m.content };
}

async function deleteMemory(userId, id) {
  const { rowCount } = await pool.query('DELETE FROM chat_memories WHERE id = $1 AND user_id = $2', [Number(id), userId]);
  return rowCount > 0;
}

function memoryPrompt(memories) {
  const list = memories.length
    ? memories.map(m => `- [${m.id}] ${m.content}`).join('\n')
    : '(nothing saved yet)';
  return `

MEMORY — things this user asked you to remember (use them naturally; ids are for forget):
${list}

MEMORY RULES:
- Call remember only when the user explicitly asks you to remember something, or states a lasting preference about how you should answer (e.g. "always keep answers short"). Save it as one short, self-contained sentence in the third person (e.g. "Prefers short answers", "DBMS exam is on Monday 20 Oct").
- After saving, tell the user briefly what you saved.
- Call forget when they ask you to forget or change something; list_memories when they ask what you remember.
- Never save passwords, OTPs, PINs, card numbers or other people's private details.`;
}

const TOOLS = [
  {
    name: 'remember',
    description: 'Save a fact or preference the user explicitly asked you to remember, for all future chats.',
    input_schema: { type: 'object', properties: { fact: { type: 'string', description: 'One short sentence, e.g. "Prefers short answers"' } }, required: ['fact'] },
  },
  {
    name: 'forget',
    description: 'Delete a saved memory by its id (shown in the MEMORY list).',
    input_schema: { type: 'object', properties: { memory_id: { type: 'integer' } }, required: ['memory_id'] },
  },
  {
    name: 'list_memories',
    description: 'List everything currently saved in memory for this user.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

// Runs a memory tool for this user; null if the name isn't a memory tool.
// `saved` collects the facts added this turn so the app can show them.
async function runTool(userId, name, input, saved) {
  if (name === 'remember') {
    const r = await addMemory(userId, input?.fact);
    if (r.saved || r.already) saved.push(r.content);
    return r;
  }
  if (name === 'forget') {
    return (await deleteMemory(userId, input?.memory_id)) ? { forgotten: true } : { error: 'No such memory' };
  }
  if (name === 'list_memories') return { memories: await listMemories(userId) };
  return null;
}

module.exports = {
  CONTEXT_MESSAGES, MAX_MEMORIES, TOOLS,
  loadHistory, appendMessages, clearHistory, listMemories, addMemory, deleteMemory, memoryPrompt, runTool,
};
