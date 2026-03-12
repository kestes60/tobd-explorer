/**
 * TOBD Newsfeed Worker
 * Deploy to Cloudflare Workers as: tobd-newsfeed
 * 
 * SETUP REQUIRED:
 * 1. Create KV namespace called TOBD_NEWSFEED in Cloudflare dashboard
 * 2. Bind it to this Worker as variable name: TOBD_NEWSFEED
 * 3. Add secret: ANTHROPIC_API_KEY
 * 4. Add cron trigger: 0 6 * * * (runs daily at 6am UTC)
 * 5. Deploy with: wrangler deploy
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const KV_KEY = 'feed_items';
const MAX_ITEMS = 30; // Max items to keep in feed

// ─── RSS Feed Sources ─────────────────────────────────────────────────────────
const SOURCES = [
  { name: 'ICR.org',       type: 'creation', url: 'https://www.icr.org/rss/news.xml' },
  { name: 'Acts & Facts',  type: 'creation', url: 'https://www.icr.org/rss/acts_facts.xml' },
  { name: 'ARJ',           type: 'creation', url: 'https://answersresearchjournal.org/feed/' },
  { name: 'AiG',           type: 'creation', url: 'https://answersingenesis.org/feed/' },
  { name: 'Phys.org',    type: 'secular', url: 'https://phys.org/rss-feed/biology-news/' },
  { name: 'EurekAlert',  type: 'secular', url: 'https://www.eurekalert.org/rss.xml' },
];

// ─── TOBD Reversal reference (for Claude's context) ───────────────────────────
const REVERSALS = `
Reversal #1 — Life & Operations: Life enables biology; not the other way around.
Reversal #2 — Agency & Purpose: Organisms are active agents, not passive products of external forces.
Reversal #3 — Adaptation & Environment: Organisms track and respond to environments via innate CET systems; the environment does nothing to them.
Reversal #4 — Causation & Design: Engineering causality (designed internal systems) explains adaptation; randomness + selection does not.
Reversal #5 — Externalism vs. Internalism: Innate internal systems drive all adaptation; external forces are merely triggers.
Reversal #6 — Common Design vs. Common Ancestry: Similar features across organisms reflect a common Designer, not common descent.
`;

// ─── Fetch handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // GET /newsfeed — serve cached feed from KV
    if (url.pathname === '/newsfeed' && request.method === 'GET') {
      const cached = await env.TOBD_NEWSFEED.get(KV_KEY);
      if (!cached) {
        return new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }
      return new Response(cached, {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // POST /refresh — manual trigger for testing (remove in production if desired)
    if (url.pathname === '/refresh' && request.method === 'POST') {
      await runFeedUpdate(env);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    return new Response('Not found', { status: 404 });
  },

  // ─── Scheduled cron handler ─────────────────────────────────────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runFeedUpdate(env));
  }
};

// ─── Main feed update logic ────────────────────────────────────────────────────
async function runFeedUpdate(env) {
  // Load existing items to avoid reprocessing
  const existingRaw = await env.TOBD_NEWSFEED.get(KV_KEY);
  const existing = existingRaw ? JSON.parse(existingRaw) : [];
  const existingLinks = new Set(existing.map(i => i.link));

  const newItems = [];

  for (const source of SOURCES) {
    try {
      const items = await fetchRSS(source);
      for (const item of items) {
        if (existingLinks.has(item.link)) continue; // already processed
        const processed = await processTOBD(item, env);
        if (processed) newItems.push(processed);
        // Small delay to avoid rate limiting Claude API
        await sleep(500);
      }
    } catch (err) {
      console.error(`Failed to fetch ${source.name}:`, err);
    }
  }

  if (newItems.length === 0) return; // nothing new

  // Merge new items at front, trim to MAX_ITEMS
  const merged = [...newItems, ...existing].slice(0, MAX_ITEMS);
  await env.TOBD_NEWSFEED.put(KV_KEY, JSON.stringify(merged));
  console.log(`Feed updated: ${newItems.length} new items, ${merged.length} total`);
}

// ─── RSS Fetcher & Parser ──────────────────────────────────────────────────────
async function fetchRSS(source) {
  const proxyURL = `https://api.allorigins.win/raw?url=${encodeURIComponent(source.url)}`;
  const res = await fetch(proxyURL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TOBDExplorerBot/1.0)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseRSS(xml, source);
}

function parseRSS(xml, source) {
  const items = [];
  // Match <item> blocks
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = stripTags(extractTag(block, 'title')).trim();
    const link  = extractTag(block, 'link') || extractAttr(block, 'link', 'href');
    const desc  = stripTags(extractTag(block, 'description') || extractTag(block, 'summary')).slice(0, 300);
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || '';
    if (!title || !link) continue;
    items.push({
      source: source.name,
      type: source.type,
      headline: title,
      link: link.trim(),
      description: desc,
      date: formatDate(pubDate),
    });
    if (items.length >= 3) break; // max 3 per source per run
  }
  return items;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
}

function formatDate(raw) {
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  } catch { return ''; }
}

// ─── TOBD Lens via Claude API ──────────────────────────────────────────────────
async function processTOBD(item, env) {
  const prompt = `You are analyzing a science news article through the TOBD (Theory of Biological Design) lens developed by Dr. Randy Guliuzza of the Institute for Creation Research.

STEP 1: Determine if this article is biologically relevant — meaning it deals with biology, genetics, biochemistry, living organisms, ecology, or life sciences. Articles about astronomy, physics, geology, cosmology, climate, technology, or other non-biological topics are NOT relevant.

If the article is NOT biologically relevant, return ONLY: {"skip": true}

STEP 2: If the article IS biologically relevant, analyze it through the TOBD lens.

TOBD Reversals for reference:
${REVERSALS}

Article:
Source: ${item.source} (${item.type === 'secular' ? 'secular science' : 'creation science'})
Headline: "${item.headline}"
Summary: ${item.description || '(no summary available)'}

Return ONLY a JSON object with these exact fields, no other text:
{
  "tobd": "2-4 sentence TOBD interpretation of this article. Connect it to the relevant reversal. Be confident, clear, and accessible. Not preachy.",
  "reversal": "Reversal #N",
  "reversalTitle": "Title of the reversal",
  "shareText": "A punchy 3-line share post: line 1 = source + headline paraphrase, line 2 = one-line TOBD insight, line 3 = 'This is what the Theory of Biological Design predicts.' Keep total under 240 chars."
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Use Haiku for cost efficiency on batch processing
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (parsed.skip) {
      console.log(`Skipped non-biological article: "${item.headline}"`);
      return null;
    }

    return {
      id: hashStr(item.link),
      type: item.type,
      source: item.source,
      date: item.date,
      headline: item.headline,
      link: item.link,
      tobd: parsed.tobd,
      reversal: parsed.reversal,
      reversalTitle: parsed.reversalTitle,
      shareText: parsed.shareText,
    };
  } catch (err) {
    console.error(`TOBD processing failed for "${item.headline}":`, err);
    return null;
  }
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
