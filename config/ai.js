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

// Saved in app_settings 'ai_provider' as { provider, gemini_model }.
let settingsCache = { value: null, at: 0 };

const defaultProvider = () =>
  PROVIDERS.includes(process.env.AI_PROVIDER) ? process.env.AI_PROVIDER : hasKey.gemini() ? 'gemini' : 'anthropic';

async function getSettings() {
  if (settingsCache.value && Date.now() - settingsCache.at < 30_000) return settingsCache.value;
  let saved = {};
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'ai_provider'`);
    saved = rows[0]?.value || {};
  } catch (err) {
    console.warn('Reading AI settings failed:', err.message);
  }
  const value = {
    provider: PROVIDERS.includes(saved.provider) ? saved.provider : defaultProvider(),
    gemini_model: typeof saved.gemini_model === 'string' ? saved.gemini_model : null,
  };
  settingsCache = { value, at: Date.now() };
  return value;
}

const getProvider = async () => (await getSettings()).provider;

// changes: { provider?, gemini_model? } (gemini_model null = automatic)
async function saveSettings(changes, userId) {
  const next = { ...(await getSettings()), ...changes };
  if (!PROVIDERS.includes(next.provider)) throw Object.assign(new Error('Unknown provider'), { status: 400 });
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('ai_provider', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [next, userId]
  );
  settingsCache = { value: next, at: Date.now() };
  return next;
}

const setProvider = (provider, userId) => saveSettings({ provider }, userId).then(s => s.provider);

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
let geminiList = { models: null, at: 0 };
let geminiWorking = null; // the last model that answered
const noThinkingConfig = new Set(); // models that rejected thinkingConfig

// Every Gemini model this key can use for generateContent, sorted: Google's
// stable "gemini-flash-latest" alias, then gemini-X-flash newest first, then
// the lite models. Cached for 6 hours.
async function geminiAvailable() {
  if (geminiList.models && Date.now() - geminiList.at < 6 * 3600_000) return geminiList.models;
  let models = [];
  try {
    const res = await fetch(`${GEMINI}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const ids = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''));
    const ver = (re) => ids.map(id => ({ id, v: re.exec(id)?.[1] })).filter(m => m.v)
      .sort((a, b) => parseFloat(b.v) - parseFloat(a.v)).map(m => m.id);
    models = [
      ...ids.filter(id => id === 'gemini-flash-latest'),
      ...ver(/^gemini-(\d+(?:\.\d+)?)-flash$/),
      ...ver(/^gemini-(\d+(?:\.\d+)?)-flash-lite$/),
    ];
  } catch (err) {
    console.warn('Listing Gemini models failed:', err.message);
  }
  geminiList = { models: models.length ? models : ['gemini-flash-latest'], at: models.length ? Date.now() : 0 };
  return geminiList.models;
}

// A model that just timed out or was overloaded sits out for a while, so the
// next request doesn't wait on it again.
const COOLDOWN_MS = 10 * 60_000;
const coolingUntil = new Map();
const cooling = (m) => (coolingUntil.get(m) || 0) > Date.now();

// Models to try, best first: GEMINI_MODEL env, else the admin's pinned model,
// else the last one that worked, then the rest; models cooling down go last.
async function geminiCandidates() {
  if (process.env.GEMINI_MODEL) return [process.env.GEMINI_MODEL];
  const list = await geminiAvailable();
  const { gemini_model: pinned } = await getSettings();
  const first = [pinned, geminiWorking].filter(m => m && list.includes(m));
  const ordered = [...new Set([...first, ...list])];
  return [...ordered.filter(m => !cooling(m)), ...ordered.filter(cooling)];
}

const geminiModel = async () => (await geminiCandidates())[0];

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

// One request to one model. Throws with .retryable when another model might work.
async function geminiRequest(model, baseBody) {
  // Gemini 3+ models think before answering; "low" is plenty for writing
  // quizzes and keeps a request well under a minute.
  const thinking = /^gemini-([3-9]|\d{2,})/.test(model) && !noThinkingConfig.has(model);
  const body = thinking
    ? { ...baseBody, generationConfig: { ...baseBody.generationConfig, thinkingConfig: { thinkingLevel: 'low' } } }
    : baseBody;
  let res;
  try {
    res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(75000),
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw Object.assign(
      new AiUnavailable(timeout ? 'Gemini took too long to answer. Try again in a minute.' : 'Could not reach Gemini. Try again in a minute.'),
      { retryable: timeout, detail: `${model}: ${timeout ? 'timeout' : err?.cause?.code || err?.message}` }
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const detail = `${model}: ${res.status} ${msg}`.slice(0, 400);
    if (thinking && res.status === 400 && /thinking/i.test(msg)) {
      noThinkingConfig.add(model);
      return geminiRequest(model, baseBody);
    }
    if (res.status === 401 || res.status === 403 || /api key not valid|invalid api key/i.test(msg)) {
      throw Object.assign(new AiUnavailable('The Gemini key is invalid.'), { detail });
    }
    if (res.status === 429) throw Object.assign(new AiUnavailable('Gemini\'s free limit is used up for now. Try again later.'), { retryable: true, detail });
    if (res.status === 404 || res.status >= 500) throw Object.assign(new AiUnavailable('Gemini is having trouble. Try again in a minute.'), { retryable: true, detail });
    throw Object.assign(new Error(msg), { retryable: res.status === 400, detail });
  }
  const cand = data.candidates?.[0];
  if (!cand?.content?.parts?.length) {
    if (cand?.finishReason === 'SAFETY') throw new Error('Gemini declined to answer this one.');
    throw Object.assign(new Error('The AI gave an empty answer. Try again.'), { detail: `${model}: finish ${cand?.finishReason}` });
  }
  return cand;
}

// Send one request, falling through to the next model when one is down.
// Returns the first candidate.
async function geminiGenerate(body) {
  const tried = [];
  let lastErr;
  for (const model of (await geminiCandidates()).slice(0, 2)) {
    try {
      const cand = await geminiRequest(model, body);
      geminiWorking = model;
      coolingUntil.delete(model);
      return cand;
    } catch (err) {
      lastErr = err;
      if (err.retryable) coolingUntil.set(model, Date.now() + COOLDOWN_MS);
      tried.push(err.detail || `${model}: ${err.message}`);
      if (!err.retryable) break;
    }
  }
  console.warn('Gemini failed:', tried.join(' | '));
  lastErr.detail = tried.join(' | ');
  throw lastErr;
}

async function geminiTool({ system, content, tool, maxTokens }) {
  const cand = await geminiGenerate({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: toGeminiParts(content) }],
    tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.input_schema) }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool.name] } },
    generationConfig: { maxOutputTokens: Math.max(maxTokens, 8192), temperature: 0.4 },
  });
  const call = cand.content.parts.find(p => p.functionCall)?.functionCall;
  if (!call) throw new Error('The AI gave no structured answer. Try again.');
  return call.args || {};
}

// ── Multi-turn chat with tools (the chatbots) ──────────────────────────────
// Conversations are kept in Anthropic's message format; for Gemini they are
// converted each turn, and the reply is converted back, so the chat loop in
// chatController works the same with either provider.

const declaration = (t) => {
  const params = toGeminiSchema(t.input_schema || { type: 'object' });
  // Gemini rejects an OBJECT with no properties; such tools take no arguments.
  const empty = !params.properties || !Object.keys(params.properties).length;
  return { name: t.name, description: t.description || t.name, ...(empty ? {} : { parameters: params }) };
};

function toGeminiContents(messages) {
  const names = {}; // tool_use id -> tool name, for the matching results
  const contents = [];
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []);
    const parts = [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text?.trim()) {
        parts.push(b._sig ? { text: b.text, thoughtSignature: b._sig } : { text: b.text });
      } else if (b.type === 'tool_use') {
        names[b.id] = b.name;
        parts.push({ functionCall: { name: b.name, args: b.input || {} }, ...(b._sig ? { thoughtSignature: b._sig } : {}) });
      } else if (b.type === 'tool_result') {
        let result = b.content;
        try { result = JSON.parse(b.content); } catch { /* keep the string */ }
        parts.push({ functionResponse: { name: names[b.tool_use_id] || 'tool', response: { result } } });
      }
    }
    if (parts.length) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}

async function geminiChat({ system, messages, tools, maxTokens }) {
  const cand = await geminiGenerate({
    systemInstruction: { parts: [{ text: system }] },
    contents: toGeminiContents(messages),
    ...(tools?.length ? {
      tools: [{ functionDeclarations: tools.map(declaration) }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    } : {}),
    generationConfig: { maxOutputTokens: Math.max(maxTokens, 4096), temperature: 0.5 },
  });
  let n = 0;
  const content = [];
  for (const p of cand.content.parts) {
    if (p.thought) continue; // the model's private reasoning
    if (p.functionCall) {
      // Gemini 3 needs each call's thought signature sent back with it next turn.
      content.push({ type: 'tool_use', id: `gemini_${Date.now()}_${n++}`, name: p.functionCall.name,
        input: p.functionCall.args || {}, ...(p.thoughtSignature ? { _sig: p.thoughtSignature } : {}) });
    } else if (p.text) {
      content.push({ type: 'text', text: p.text, ...(p.thoughtSignature ? { _sig: p.thoughtSignature } : {}) });
    }
  }
  return { content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
}

async function anthropicChat({ system, messages, tools, maxTokens }) {
  try {
    return await getClient().messages.create({
      model: FAST_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools?.length ? { tools } : {}),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/credit balance/i.test(msg)) throw new AiUnavailable('Anthropic credits have run out. An admin can switch to Gemini.');
    if (err?.status === 401) throw new AiUnavailable('The Anthropic key is invalid.');
    if (err?.status === 429 || err?.status === 529 || /overloaded/i.test(msg)) throw new AiUnavailable('The AI is busy. Try again in a minute.');
    throw err;
  }
}

// One assistant turn: returns { content: [text/tool_use blocks], stop_reason }.
async function chatTurn({ system, messages, tools, maxTokens = 4096 }) {
  const provider = await getProvider();
  if (!hasKey[provider]()) {
    throw new AiUnavailable(`${provider === 'gemini' ? 'Gemini' : 'Anthropic'} is not set up on the server.`);
  }
  return provider === 'gemini'
    ? geminiChat({ system, messages, tools, maxTokens })
    : anthropicChat({ system, messages, tools, maxTokens });
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
async function test(tool = null) {
  const provider = await getProvider();
  const started = Date.now();
  try {
    const out = await callTool({
      system: 'Reply using the tool.',
      content: [{ type: 'text', text: tool ? 'Topic: binary search trees. Use the tool with a small example.' : 'Say hello in one word.' }],
      tool: tool || { name: 'reply', description: 'Send the reply.', input_schema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } },
      maxTokens: 200,
    });
    return { ok: true, provider, model: provider === 'gemini' ? await geminiModel() : MODEL, ms: Date.now() - started, reply: tool ? out : out.word };
  } catch (err) {
    return { ok: false, provider, model: provider === 'gemini' ? await geminiModel().catch(() => null) : MODEL, ms: Date.now() - started, error: err.message, detail: err.detail || null };
  }
}

async function status() {
  const { provider, gemini_model } = await getSettings();
  const geminiOn = hasKey.gemini();
  return {
    provider,
    providers: {
      anthropic: { configured: hasKey.anthropic(), model: MODEL },
      gemini: {
        configured: geminiOn,
        model: geminiOn ? await geminiModel() : null,
        pinned: process.env.GEMINI_MODEL || gemini_model,
        pinned_by_env: Boolean(process.env.GEMINI_MODEL),
        models: geminiOn ? await geminiAvailable() : [],
        cooling: geminiOn ? (await geminiAvailable()).filter(cooling) : [],
      },
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
  MODEL, FAST_MODEL, PROVIDERS, configured, callTool, chatTurn, fileBlock, setClient, AiUnavailable,
  getProvider, setProvider, saveSettings, status, test, geminiAvailable, _internal: { toGeminiSchema, toGeminiParts, geminiModel, toGeminiContents, declaration },
};
