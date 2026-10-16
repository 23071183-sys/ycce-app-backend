const Anthropic = require('@anthropic-ai/sdk');

// Claude for the study tools. Every call asks for one tool and forces it, so the
// answer always comes back as JSON matching the schema instead of free text.

const MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const FAST_MODEL = process.env.AI_FAST_MODEL || 'claude-haiku-5-5';

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};
// Tests swap in a fake.
const setClient = (c) => { client = c; };

const configured = () => Boolean(process.env.ANTHROPIC_API_KEY);

class AiUnavailable extends Error {
  constructor(message) { super(message); this.status = 503; }
}

// content: the user message content blocks. Returns the tool input object.
async function callTool({ system, content, tool, model = MODEL, maxTokens = 8000 }) {
  if (!configured()) throw new AiUnavailable('AI is not set up on the server');
  try {
    const res = await getClient().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content }],
    });
    const block = res.content.find(b => b.type === 'tool_use');
    if (!block) throw new Error('The AI gave no structured answer');
    return block.input;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/credit balance/i.test(msg)) throw new AiUnavailable('AI credits have run out. Ask an admin to top up.');
    if (err?.status === 429 || err?.status === 529 || /overloaded/i.test(msg)) throw new AiUnavailable('The AI is busy. Try again in a minute.');
    throw err;
  }
}

// Download a file (a paper or notes PDF) and turn it into a content block.
const MAX_BYTES = 20 * 1024 * 1024;
async function fileBlock(url, name = '') {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Could not download the file (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('File is too large to read (20MB max)');
  const type = (res.headers.get('content-type') || '').split(';')[0];
  const isPdf = type === 'application/pdf' || /\.pdf$/i.test(name || url) || buf.subarray(0, 4).toString() === '%PDF';
  if (isPdf) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } };
  }
  const img = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].find(t => t === type)
    || (/\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : null);
  if (img) return { type: 'image', source: { type: 'base64', media_type: img, data: buf.toString('base64') } };
  if (/^text\//.test(type)) return { type: 'text', text: buf.toString('utf8').slice(0, 200000) };
  throw new Error('Only PDF, image or text files can be read');
}

module.exports = { MODEL, FAST_MODEL, configured, callTool, fileBlock, setClient, AiUnavailable };
