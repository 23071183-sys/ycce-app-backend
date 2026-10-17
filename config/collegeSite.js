// Read-only access to the college's official website (ycce.edu) for the chat
// assistants, so answers about the college and department come from the
// college's own pages instead of the model's memory.
//
// Only https://ycce.edu pages are ever fetched (redirects elsewhere are
// refused), and results are cached so repeat questions don't hit the site.

const SITE = 'https://ycce.edu';
const HOSTS = new Set(['ycce.edu', 'www.ycce.edu']);
const UA = 'YCCE-CT-App/1.0 (+https://ycce-app-web.vercel.app)';
const PAGE_TTL = 6 * 3600_000;
const SEARCH_TTL = 3600_000;
const MAX_TEXT = 12000;

const cache = new Map(); // key -> { at, ttl, value }
const cached = async (key, ttl, load) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), ttl, value });
  if (cache.size > 300) cache.delete(cache.keys().next().value); // drop the oldest
  return value;
};

function officialUrl(raw) {
  let u;
  try { u = new URL(String(raw || ''), SITE); } catch { return null; }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return null;
  u.hash = '';
  return u;
}

// GET a ycce.edu URL, following at most 3 redirects and only within ycce.edu.
async function get(url) {
  let target = officialUrl(url);
  for (let hop = 0; target && hop < 4; hop++) {
    const res = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.5' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      target = officialUrl(new URL(res.headers.get('location'), target));
      continue;
    }
    return res;
  }
  throw new Error('That link is not on the official college website.');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '—', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '…', bull: '•' };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

// Readable text from an HTML fragment, keeping line breaks and the targets of
// links to documents (PDFs etc.) so they can be cited.
function toText(html) {
  return decode(String(html)
    .replace(/<(script|style|noscript|svg|iframe|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\s[^>]*href="([^"]+\.(?:pdf|docx?|xlsx?))"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => ` ${label} (${href}) `)
    .replace(/<img\s[^>]*alt="([^"]{3,})"[^>]*>/gi, ' $1 ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|ul|ol|table)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// Search also matches page-builder templates and widget fragments; not pages.
const JUNK_KINDS = new Set(['elementor_library', 'elementskit_content', 'elementskit_template', 'jet-engine',
  'jet-popup', 'jet-theme-core', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'nav_menu_item', 'attachment']);

const SITE_CHROME = /^(Skip to content|Menu|Search|Toggle navigation|Close)$/i;

// Search the official site (WordPress search over pages, posts, departments…).
async function searchSite(query) {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) return { results: [], error: 'Give a search query' };
  return cached(`s:${q.toLowerCase()}`, SEARCH_TTL, async () => {
    // Templates often fill the first results, so ask for more and filter.
    const res = await get(`${SITE}/wp-json/wp/v2/search?search=${encodeURIComponent(q)}&per_page=50`);
    if (!res.ok) return { results: [], error: `Website search failed (${res.status})` };
    const rows = await res.json();
    return {
      results: rows
        .filter(r => officialUrl(r.url) && !JUNK_KINDS.has(r.subtype) && !/[?&]elementor_library=/.test(r.url))
        .map(r => ({ title: decode(r.title || ''), url: r.url, kind: r.subtype }))
        .slice(0, 8),
    };
  });
}

// Tabs on department pages load their content from the page itself, which is
// how the site's own script does it; that way fields like the HoD's name are
// filled in for that department.
async function tabText(pageUrl, templateId) {
  return cached(`t:${pageUrl}#${templateId}`, PAGE_TTL, async () => {
    const u = new URL(pageUrl);
    u.search = new URLSearchParams({ id: templateId, dev: 'false', jet_tabs_self: '1' }).toString();
    const res = await get(u.toString());
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    return toText(data.template_content || '');
  });
}

async function loadPage(url) {
  return cached(`p:${url}`, PAGE_TTL, async () => {
    const res = await get(url);
    if (!res.ok) return { error: `The page could not be opened (${res.status})` };
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) {
      return { url, title: url.split('/').filter(Boolean).pop(), text: '', sections: [], document: true };
    }
    const html = await res.text();
    const title = decode((/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim());
    const sections = [...html.matchAll(/data-template-id="(\d+)"[\s\S]{0,400}?jet-tabs__label-text">([\s\S]*?)<\/div>/g)]
      .map(m => ({ id: m[1], name: decode(m[2].replace(/<[^>]+>/g, '').trim()) }))
      .filter((s, i, all) => s.name && all.findIndex(x => x.id === s.id) === i);
    const body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0]
      || /<article[\s\S]*?<\/article>/i.exec(html)?.[0]
      || html.replace(/<(header|footer|nav)[\s\S]*?<\/\1>/gi, ' ');
    const text = toText(body).split('\n').filter(l => !SITE_CHROME.test(l.trim())).join('\n');
    return { url, title, text, sections };
  });
}

// Read a page; with `section` (e.g. "Placements", "HoD Desk"), read that tab.
async function readPage(rawUrl, section) {
  const u = officialUrl(rawUrl);
  if (!u) return { error: 'Only pages on the official college website (https://ycce.edu) can be read.' };
  const url = u.toString();
  const page = await loadPage(url);
  if (page.error) return page;
  if (page.document) {
    return { url, title: page.title, note: 'This is a document (e.g. PDF), not a web page. Share the link with the user.' };
  }
  const names = page.sections.map(s => s.name);
  if (section) {
    const want = String(section).toLowerCase();
    const s = page.sections.find(x => x.name.toLowerCase() === want)
      || page.sections.find(x => x.name.toLowerCase().includes(want) || want.includes(x.name.toLowerCase()));
    if (!s) return { url, title: page.title, error: `No section "${section}" on this page`, sections: names };
    const text = await tabText(url, s.id);
    return { url, title: page.title, section: s.name, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
  }
  return {
    url,
    title: page.title,
    text: page.text.slice(0, MAX_TEXT),
    truncated: page.text.length > MAX_TEXT,
    ...(names.length ? { sections: names, hint: 'Call again with section set to read one of these.' } : {}),
  };
}

const TOOLS = [
  {
    name: 'search_college_website',
    description: "Search YCCE's official website (ycce.edu) — departments, programmes and intake, admissions, fees, placements, accreditation (NAAC/NBA), events, news, notices, contacts. Returns page titles and URLs to read with read_college_page.",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'A few keywords, e.g. "computer technology placements"' } }, required: ['query'] },
  },
  {
    name: 'read_college_page',
    description: "Read a page from YCCE's official website (only https://ycce.edu URLs). Department pages are split into sections (About Department, HoD Desk, Faculty, Placements, PEO/PO, Events…): read the page first to see them, then pass `section` to read one.",
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'A https://ycce.edu/... URL, e.g. from search_college_website' },
        section: { type: 'string', description: 'Optional section (tab) name on the page, e.g. "Placements"' },
      },
      required: ['url'],
    },
  },
];

// The Computer Technology department page, a good first stop for CT questions.
const CT_DEPARTMENT_URL = `${SITE}/departments/department-of-computer-technology/`;

async function runTool(name, input) {
  try {
    if (name === 'search_college_website') return await searchSite(input?.query);
    if (name === 'read_college_page') return await readPage(input?.url, input?.section);
  } catch (err) {
    return { error: `The college website could not be reached right now (${err.message}).` };
  }
  return null;
}

const PROMPT_RULES = `
COLLEGE & DEPARTMENT INFORMATION (official sources only):
- For questions about YCCE or the Computer Technology department — programmes and intake, admissions, fees, placements and packages, accreditation, HoD's message, vision/mission, PEOs/POs, facilities, labs, events, achievements, contacts — use search_college_website and read_college_page and answer ONLY from what those pages say.
- The CT department page is ${CT_DEPARTMENT_URL}; its sections hold most department details.
- End such answers with the page(s) used, as Markdown links, e.g. "Source: [CT Department – Placements](${CT_DEPARTMENT_URL})".
- If the official website doesn't say, tell the user you couldn't find it on the official site and share ${SITE}. Never fill gaps from memory or other websites.`;

module.exports = { TOOLS, runTool, PROMPT_RULES, searchSite, readPage, officialUrl, _internal: { toText, decode, cache } };
