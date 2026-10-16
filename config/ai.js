const Anthropic = require('@anthropic-ai/sdk');
const pool = require('./database');

// AI for the study tools, from either Anthropic (Claude) or Google (Gemini).
// Admins pick the provider at runtime (app_settings 'ai_provider'); with no
// choice saved it is AI_PROVIDER, else Gemini when its key is set.
// Every call asks for one tool/function and forces it, so the answer always
// comes back as JSON matching the schema instead of free text.

const MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const FAST_MODEL = process.env.AI_FAST_MODEL || 'claude-haiku-5-5';
const PROVIDERS = ['anthropic', 'gemini'];

const hasKey = {
  anthropic: () => Boolean(process.env.ANTHROPIC_API_KEY),
  gemini: () => Boolean(process.env.GEMINI_API_KEY),
};
// True when at least one provider could work; callTool checks the chosen one.
const configured = () => hasKey.anthropic() || hasKey.gemini();

class AiUnavailable extends Error {
  constructor(message) { super(message); this.status = 503; }
}

// ── Provider choice ────────────────────────────────────────────────────────

let providerCache = { value: null, at: 0 };

const defaultProvider = () =>
  PROVIDERS.includes(process.env.AI_PROVIDER) ? process.env.AI_PROVIDER : hasKey.gemini() ? 'gemini' : 'anthropic';

async function getProvider() {
  if (providerCache.value && Date.now() - providerCache.at < 30_000) return providerCache.value;
  let value = defaultProvider();
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'ai_provider'`);
    if (PROVIDERS.includes(rows[0]?.value?.provider)) value = rows[0].value.provider;
  } catch (err) {
    console.warn('Reading AI provider setting failed:', err.message);
  }
  providerCache = { value, at: Date.now() };
  return value;
}

async function setProvider(provider, userId) {
  if (!PROVIDERS.includes(provider)) throw Object.assign(new Error('Unknown provider'), { status: 400 });
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('ai_provider', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [{ provider }, userId]
  );
  providerCache = { value: provider, at: Date.now() };
  return provider;
}

// ── Anthropic ──────────────────────────────────────────────────────────────

let client = null;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};
// Tests swap in a fake.
const setClient = (c) => { client = c; };

async function anthropicTool({ system, content, tool, model, maxTokens }) {
  try {
    const res = await getClient().messages.create({
      model: model || MODEL,
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
    if (/credit balance/i.test(msg)) throw new AiUnavailable('Anthropic credits have run out. An admin can switch to Gemini.');
    if (err?.status === 401) throw new AiUnavailable('The Anthropic key is invalid.');
    if (err?.status === 429 || err?.status === 529 || /overloaded/i.test(msg)) throw new AiUnavailable('The AI is busy. Try again in a minute.');
    throw err;
  }
}

// ── Gemini (REST, no SDK) ──────────────────────────────────────────────────

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
let geminiModelCache = { name: null, at: 0 };

// Use GEMINI_MODEL if set; otherwise ask Google which models this key has and
// take the newest stable "gemini-X-flash" (no lite/preview/experimental).
async function geminiModel() {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (geminiModelCache.name && Date.now() - geminiModelCache.at < 6 * 3600_000) return geminiModelCache.name;
  let pick = null;
  try {
    const res = await fetch(`${GEMINI}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const flash = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => ({ id: m.name.replace(/^models\//, ''), v: /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(m.name.replace(/^models\//, ''))?.[1] }))
      .filter(m => m.v)
      .sort((a, b) => parseFloat(b.v) - parseFloat(a.v));
    pick = flash[0]?.id || (data.models || []).find(m => m.name === 'models/gemini-flash-latest') && 'gemini-flash-latest';
  } catch (err) {
    console.warn('Listing Gemini models failed:', err.message);
  }
  geminiModelCache = { name: pick || 'gemini-flash-latest', at: pick ? Date.now() : 0 };
  return geminiModelCache.name;
}

// Gemini takes an OpenAPI-style subset of JSON Schema: upper-case types,
// `nullable` instead of ['x','null'], and no unknown keywords.
function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  let type = s.type;
  if (Array.isArray(type)) {
    if (type.includes('null')) out.nullable = true;
    type = type.find(t => t !== 'null');
  }
  if (type) out.type = String(type).toUpperCase();
  for (const k of ['description', 'enum', 'required', 'nullable', 'minimum', 'maximum', 'minItems', 'maxItems']) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

const toGeminiParts = (content) => content.map(b => {
  if (b.type === 'text') return { text: b.text };
  if ((b.type === 'document' || b.type === 'image') && b.source?.type === 'base64') {
    return { inlineData: { mimeType: b.source.media_type, data: b.source.data } };
  }
  throw new Error(`Unsupported content for Gemini: ${b.type}`);
});

async function geminiTool({ system, content, tool, maxTokens }) {
  const model = await geminiModel();
  let res;
  try {
    res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: toGeminiParts(content) }],
        tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.input_schema) }] }],
        toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool.name] } },
        generationConfig: { maxOutputTokens: Math.max(maxTokens, 8192), temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AiUnavailable('Gemini took too long to answer. Try again in a minute.');
    }
    throw new AiUnavailable(`Could not reach Gemini (${err?.cause?.code || err?.message}).`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini responded ${res.status}`;
    if (res.status === 429) throw new AiUnavailable('Gemini\'s free limit is used up for now. Try again later.');
    if (res.status === 401 || res.status === 403 || /api key/i.test(msg)) throw new AiUnavailable('The Gemini key is invalid.');
    if (res.status === 404) geminiModelCache = { name: null, at: 0 }; // model gone: re-pick next time
    if (res.status >= 500) throw new AiUnavailable('Gemini is having trouble. Try again in a minute.');
    throw new Error(msg);
  }
  const cand = data.candidates?.[0];
  const call = cand?.content?.parts?.find(p => p.functionCall)?.functionCall;
  if (!call) {
    if (cand?.finishReason === 'SAFETY') throw new Error('Gemini declined to answer this one.');
    throw new Error('The AI gave no structured answer. Try again.');
  }
  return call.args || {};
}

// ── Shared entry point ─────────────────────────────────────────────────────

// content: the user message content blocks (Anthropic format; converted for
// Gemini). Returns the tool input object.
async function callTool({ system, content, tool, model, maxTokens = 8000 }) {
  const provider = await getProvider();
  if (!hasKey[provider]()) {
    throw new AiUnavailable(`${provider === 'gemini' ? 'Gemini' : 'Anthropic'} is not set up on the server.`);
  }
  return provider === 'gemini'
    ? geminiTool({ system, content, tool, maxTokens })
    : anthropicTool({ system, content, tool, model, maxTokens });
}

// A tiny forced-tool call against the chosen provider: is it set up and how fast?
async function test() {
  const provider = await getProvider();
  const started = Date.now();
  try {
    const out = await callTool({
      system: 'Reply using the tool.',
      content: [{ type: 'text', text: 'Say hello in one word.' }],
      tool: { name: 'reply', description: 'Send the reply.', input_schema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } },
      maxTokens: 200,
    });
    return { ok: true, provider, model: provider === 'gemini' ? await geminiModel() : MODEL, ms: Date.now() - started, reply: out.word };
  } catch (err) {
    return { ok: false, provider, model: provider === 'gemini' ? await geminiModel().catch(() => null) : MODEL, ms: Date.now() - started, error: err.message };
  }
}

async function status() {
  const provider = await getProvider();
  return {
    provider,
    providers: {
      anthropic: { configured: hasKey.anthropic(), model: MODEL },
      gemini: { configured: hasKey.gemini(), model: hasKey.gemini() ? await geminiModel() : null },
    },
  };
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

module.exports = {
  MODEL, FAST_MODEL, PROVIDERS, configured, callTool, fileBlock, setClient, AiUnavailable,
  getProvider, setProvider, status, test, _internal: { toGeminiSchema, toGeminiParts, geminiModel },
};
