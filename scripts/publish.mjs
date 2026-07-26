import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dateLabel, escapeHtml, pageShell } from './lib.mjs';

const root = process.cwd();
const zone = 'America/Chicago';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(new Date()));
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone }).format(new Date());
const force = process.env.FORCE_PUBLISH === 'true';
const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
const archiveDir = path.join(root, 'Archive', today);
const allowedHosts = new Map([
  ['reuters.com', 'Reuters'], ['apnews.com', 'Associated Press'], ['cnbc.com', 'CNBC'],
  ['bloomberg.com', 'Bloomberg'], ['ft.com', 'Financial Times'], ['wsj.com', 'The Wall Street Journal'],
  ['bbc.com', 'BBC'], ['bbc.co.uk', 'BBC'], ['axios.com', 'Axios'], ['semafor.com', 'Semafor'],
  ['theverge.com', 'The Verge'], ['techcrunch.com', 'TechCrunch'], ['arstechnica.com', 'Ars Technica'], ['wired.com', 'WIRED'],
  ['ieee.org', 'IEEE Spectrum'], ['venturebeat.com', 'VentureBeat'], ['tomshardware.com', "Tom's Hardware"],
  ['theregister.com', 'The Register'], ['siliconangle.com', 'SiliconANGLE'], ['blocksandfiles.com', 'Blocks & Files'],
  ['datacenterdynamics.com', 'Data Center Dynamics'], ['datacenterknowledge.com', 'Data Center Knowledge'], ['capacitymedia.com', 'Capacity Media'],
  ['lightreading.com', 'Light Reading'], ['fierce-network.com', 'Fierce Network'], ['semianalysis.com', 'SemiAnalysis'],
  ['nvidia.com', 'NVIDIA'], ['amd.com', 'AMD'], ['intel.com', 'Intel'], ['broadcom.com', 'Broadcom'],
  ['micron.com', 'Micron'], ['arm.com', 'Arm'], ['qualcomm.com', 'Qualcomm'], ['marvell.com', 'Marvell'],
  ['dell.com', 'Dell'], ['hpe.com', 'HPE'], ['cisco.com', 'Cisco'], ['juniper.net', 'Juniper Networks'], ['supermicro.com', 'Supermicro'],
  ['microsoft.com', 'Microsoft'], ['aws.amazon.com', 'AWS'], ['aboutamazon.com', 'Amazon'], ['cloud.google.com', 'Google Cloud'],
  ['blog.google', 'Google'], ['ai.google', 'Google'], ['about.fb.com', 'Meta'], ['ai.meta.com', 'Meta'], ['openai.com', 'OpenAI'],
  ['anthropic.com', 'Anthropic'], ['oracle.com', 'Oracle'], ['tsmc.com', 'TSMC'], ['samsung.com', 'Samsung'],
  ['skhynix.com', 'SK hynix'], ['coreweave.com', 'CoreWeave'], ['x.ai', 'xAI'], ['ibm.com', 'IBM'],
  ['equinix.com', 'Equinix'], ['digitalrealty.com', 'Digital Realty'], ['vertiv.com', 'Vertiv'], ['schneider-electric.com', 'Schneider Electric'],
  ['eaton.com', 'Eaton'], ['bloomenergy.com', 'Bloom Energy'], ['constellationenergy.com', 'Constellation Energy'],
  ['sec.gov', 'U.S. SEC'], ['energy.gov', 'U.S. Department of Energy'], ['ferc.gov', 'FERC'],
  ['ec.europa.eu', 'European Commission'], ['gov.uk', 'UK Government']
]);
const queries = [
  'artificial intelligence model launch company',
  'Nvidia AMD AI chip semiconductor data center',
  'hyperscaler data center capacity power cooling networking',
  'AI infrastructure investment partnership financing',
  'AI policy export controls data center energy',
  'OpenAI Anthropic Google Meta Microsoft enterprise AI news',
  'data center electricity grid project construction capacity',
  'high bandwidth memory networking optical AI infrastructure'
];
// Google News is useful for breadth, but it sometimes returns its own redirect
// pages to automated readers. These direct publisher feeds keep discovery
// resilient and ensure the article URL is the publisher's readable page.
const directFeeds = [
  'https://techcrunch.com/feed/',
  'https://www.theverge.com/rss/index.xml',
  'https://feeds.arstechnica.com/arstechnica/index',
  'https://spectrum.ieee.org/feeds/feed.rss',
  'https://www.theregister.com/headlines.atom',
  'https://siliconangle.com/feed/',
  'https://www.datacenterdynamics.com/en/rss/',
  'https://nvidianews.nvidia.com/rss.xml',
  'https://blog.google/rss/',
  'https://openai.com/news/rss.xml'
];

if (!force && (weekday !== 'Sun' || hour !== 8)) {
  console.log(`Not publishing: current ${zone} time is ${weekday} ${hour}:00; weekly editions publish Sundays at 8:00 AM.`);
  process.exit(0);
}
try {
  await readFile(path.join(archiveDir, 'edition.json'));
  if (process.env.REBUILD_EXISTING !== 'true') {
    console.log(`Edition already exists for ${today}.`);
    process.exit(0);
  }
} catch {}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required; preserving the existing live edition.');

function decode(value = '') {
  return String(value).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
function cleanText(value = '') { return decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function tag(item, name) { return cleanText(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || ''); }
function itemLink(item) {
  const textLink = tag(item, 'link');
  if (textLink) return textLink;
  const atomLink = (item.match(/<link\\b[^>]*\\bhref=["'][^"']+["'][^>]*>/i) || [])[0];
  return attr(atomLink || '', 'href');
}
function itemPublished(item) { return Date.parse(tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated')); }
function cleanTitle(title) { return title.replace(/\s+-\s+[^-]{2,80}$/, '').replace(/\s+/g, ' ').trim(); }
function hostname(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
function allowedSource(url) {
  const host = hostname(url);
  for (const [domain, label] of allowedHosts) if (host === domain || host.endsWith(`.${domain}`)) return label;
  return '';
}
function attr(tagText, name) { return decode(tagText.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'))?.[1] || ''); }
function meta(html, names) {
  for (const item of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(item, 'name') || attr(item, 'property') || attr(item, 'itemprop')).toLowerCase();
    if (names.includes(key)) return attr(item, 'content');
  }
  return '';
}
function canonicalUrl(html, fallback) {
  const link = (html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i) || [])[0];
  return attr(link || '', 'href') || meta(html, ['og:url']) || fallback;
}
function extractedText(html) {
  const likely = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  return cleanText((likely || html).replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<noscript\b[\s\S]*?<\/noscript>|<nav\b[\s\S]*?<\/nav>|<footer\b[\s\S]*?<\/footer>|<header\b[\s\S]*?<\/header>/gi, ' '));
}
function publishedFrom(html, fallback) {
  const raw = meta(html, ['article:published_time', 'date', 'datepublished', 'publish-date', 'pubdate', 'parsely-pub-date', 'og:published_time']);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : fallback;
}
function relevanceScore(text) {
  const hits = (text.toLowerCase().match(/\b(ai|artificial intelligence|model|gpu|accelerator|chip|semiconductor|data center|datacentre|cloud|hyperscaler|power|cooling|network|interconnect|memory|packaging|inference|export control)\b/g) || []).length;
  return Math.min(hits, 12);
}
function titleKey(title) { return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(word => word.length > 3).slice(0, 14).join(' '); }
function words(value) { return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 3 && !new Set(['that', 'with', 'this', 'from', 'about', 'their', 'would', 'could', 'which', 'after', 'into', 'have', 'will', 'they', 'said']).has(word))); }
function similarity(left, right) { const a = words(left); const b = words(right); const both = [...a].filter(word => b.has(word)).length; return both / Math.max(1, a.size + b.size - both); }
function isFresh(time) { return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000 && Date.now() - time <= maxAgeMs; }

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; The-Compute-Chronicles/1.0; +https://cpahl315.github.io/compute-chronicles/)', Accept: 'text/html,application/xhtml+xml' } });
  if (!response.ok || !/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '')) throw new Error(`Unreadable source (${response.status})`);
  return { html: await response.text(), url: response.url };
}

async function readCandidate(item) {
  const title = cleanTitle(tag(item, 'title'));
  const link = itemLink(item);
  const feedPublishedAt = itemPublished(item);
  if (!title || !link || !isFresh(feedPublishedAt) || title.length < 24) return null;
  try {
    const response = await fetchText(link);
    const canonical = canonicalUrl(response.html, response.url);
    const source = allowedSource(canonical) || tag(item, 'NewsSource') || tag(item, 'source') || hostname(canonical);
    const body = extractedText(response.html);
    const publishedAt = publishedFrom(response.html, feedPublishedAt);
    if (!source || !isFresh(publishedAt) || body.length < 450 || relevanceScore(`${title} ${body.slice(0, 12000)}`) < 1) return null;
    return { title, link: canonical, source, publishedAt, body, description: meta(response.html, ['description', 'og:description']), relevance: relevanceScore(`${title} ${body.slice(0, 12000)}`) };
  } catch (error) {
    console.warn(`Skipped unreadable source: ${title} (${error.message})`);
    return null;
  }
}

async function collectCandidates() {
  const googleFeeds = await Promise.all(queries.map(async query => {
    try { const response = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&hl=en-US&gl=US&ceid=US:en`, { signal: AbortSignal.timeout(12000) }); return response.ok ? response.text() : ''; } catch { return ''; }
  }));
  const publisherFeeds = await Promise.all(directFeeds.map(async feedUrl => {
    try { const response = await fetch(feedUrl, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'The-Compute-Chronicles/1.0 (+https://cpahl315.github.io/compute-chronicles/)' } }); return response.ok ? response.text() : ''; } catch { return ''; }
  }));
  const items = [...publisherFeeds, ...googleFeeds].flatMap(feed => [
    ...(feed.match(/<item>[\s\S]*?<\/item>/gi) || []),
    ...(feed.match(/<entry>[\s\S]*?<\/entry>/gi) || [])
  ]);
  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = titleKey(tag(item, 'title'));
    if (key && !seen.has(key)) { seen.add(key); unique.push(item); }
  }
  const readable = [];
  for (const item of unique.slice(0, 200)) {
    const candidate = await readCandidate(item);
    if (candidate && !readable.some(existing => similarity(existing.title, candidate.title) > 0.58 || existing.link === candidate.link)) readable.push(candidate);
  }
  return readable.sort((a, b) => b.relevance - a.relevance || b.publishedAt - a.publishedAt).slice(0, 12);
}

async function openAiJson(instructions, payload) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5-mini', input: `${instructions}\n\n${payload}`, text: { format: { type: 'json_object' } } })
  });
  if (!response.ok) throw new Error(`OpenAI editorial request failed (${response.status})`);
  const result = await response.json();
  const output = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || '').join('');
  if (!output) throw new Error('OpenAI returned no editorial output');
  return JSON.parse(output);
}
async function summarize(candidate) {
  const result = await openAiJson(
    'You are the exacting editor of The Compute Chronicles. Write one original 115-165 word newsletter summary of the supplied full article for an informed AI and data-center reader. State concrete facts from this article, identify the specific business or infrastructure implication, and use clean American English. Do not use headings, labels, quotations, advice, generic market boilerplate, or facts not in the article. Do not repeat the headline. Return JSON only: {"summary":"..."}.',
    `TITLE: ${candidate.title}\nPUBLISHER: ${candidate.source}\nPUBLISHED: ${new Date(candidate.publishedAt).toISOString()}\nARTICLE TEXT:\n${candidate.body.slice(0, 15000)}`
  );
  return { ...candidate, summary: String(result.summary || '').trim() };
}
async function review(story) {
  const result = await openAiJson(
    'You are a copy editor and fact checker. Compare the candidate summary with the source article. Approve only if every material claim is supported, the summary is 115-165 words, is specific to this article, contains no generic filler or headline restatement, and has correct spelling and grammar. If fixable, return a corrected summary. Return JSON only: {"approved":true|false,"summary":"...","reason":"brief reason"}.',
    `TITLE: ${story.title}\nSUMMARY: ${story.summary}\nSOURCE ARTICLE:\n${story.body.slice(0, 15000)}`
  );
  const summary = String(result.summary || story.summary).trim();
  const count = summary.split(/\s+/).filter(Boolean).length;
  const generic = /the story speaks to|this is a signal about|the practical question is|watch for named customers/i.test(summary);
  return { ...story, summary, validation: { sourceReadable: true, summaryReviewed: Boolean(result.approved), grammarChecked: Boolean(result.approved), unique: false, reason: result.reason || '' }, approved: Boolean(result.approved) && count >= 115 && count <= 165 && !generic };
}
async function buildStories(candidates) {
  const approved = [];
  for (const candidate of candidates) {
    const reviewed = await review(await summarize(candidate));
    if (!reviewed.approved) { console.warn(`Rejected editorially: ${candidate.title}`); continue; }
    if (approved.some(existing => similarity(existing.summary, reviewed.summary) > 0.34 || similarity(existing.title, reviewed.title) > 0.46)) { console.warn(`Rejected duplicate coverage: ${candidate.title}`); continue; }
    reviewed.validation.unique = true;
    delete reviewed.body;
    delete reviewed.relevance;
    delete reviewed.description;
    delete reviewed.approved;
    approved.push(reviewed);
    if (approved.length === 5) break;
  }
  return approved;
}
async function industryOutlook(stories) {
  const result = await openAiJson(
    'Write one 110-150 word industry-outlook passage based only on the supplied daily story summaries. Identify concrete trends and constraints relevant to AI and data centers: supply chain, power, network capacity, financing, policy, or geopolitics where present. Be specific to this edition; do not repeat a story summary, invent facts, or use generic filler. Return JSON only: {"outlook":"..."}.',
    stories.map(story => `${story.title}\n${story.summary}`).join('\n\n')
  );
  return String(result.outlook || '').trim();
}

function storyMarkup(story, index) {
  const published = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(story.publishedAt));
  return `<article class="story"><div class="story-number">${String(index + 1).padStart(2, '0')}</div><div class="story-main"><div class="story-heading"><h2>${escapeHtml(story.title)}</h2><span class="story-source">${escapeHtml(story.source)}</span></div><p class="story-summary">${escapeHtml(story.summary)}</p><div class="story-meta"><span>Published ${escapeHtml(published)} CT</span><a class="source" href="${escapeHtml(story.link)}" target="_blank" rel="noopener noreferrer">Read source <b>↗</b></a></div></div></article>`;
}
function editionBody(edition) {
  const visuals = `<section class="visual-strip"><figure><img src="./assets/data-center-hero.png" alt="Modern AI data center with liquid cooling"><figcaption>Inside the physical backbone of the AI buildout.</figcaption></figure><figure><img src="./assets/ai-chip-detail.png" alt="AI accelerator chip and fiber optics"><figcaption>Compute, interconnect, and capacity.</figcaption></figure></section>`;
  const lightWindow = edition.stories.length < 5 ? `<p class="light-window">Only ${edition.stories.length} stories cleared today’s full-text, freshness, and editorial checks. Rather than fill the edition with stale coverage, we published the qualifying items.</p>` : '';
  return `<section class="hero"><div class="eyebrow">${dateLabel(edition.date)} · Weekly briefing</div><h1>${escapeHtml(edition.headline)}</h1><p class="dek">Five consequential AI and data-center developments from the past week, with article-specific context and original reporting.</p></section>${visuals}<section class="market-pulse"><strong>EDITORIAL STANDARD</strong><span>${escapeHtml(edition.pulse)}</span></section><section><h2 class="section-title">Top stories</h2>${lightWindow}${edition.stories.map(storyMarkup).join('')}</section><section class="outlook"><div class="eyebrow">Industry outlook</div><h2>What the market is telling us.</h2><p>${escapeHtml(edition.outlook)}</p></section>`;
}
function archiveBody(editions) { return `<section class="archive-hero"><div class="eyebrow">Every daily edition</div><h1>The archive.</h1><p class="dek">A durable record of the AI and infrastructure signals that moved the market.</p></section><ol class="archive-list">${editions.map(edition => `<li><a href="./Archive/${edition.date}/index.html"><span class="meta">${dateLabel(edition.date)}</span><div><h2>${escapeHtml(edition.headline)}</h2><p>${escapeHtml(edition.dek)}</p></div><span class="arrow">↗</span></a></li>`).join('')}</ol>`; }

const candidates = await collectCandidates();
if (!candidates.length) throw new Error('No readable, reputable, fresh source articles were available; preserving the existing live edition.');
const stories = await buildStories(candidates);
if (!stories.length) throw new Error('No stories passed editorial review; preserving the existing live edition.');
const edition = {
  date: today,
  headline: stories.length === 5 ? 'Five signals shaping the AI buildout.' : `${stories.length} verified signal${stories.length === 1 ? '' : 's'} shaping the AI buildout.`,
  dek: `A full-text, source-checked scan of the newest AI and data-center developments for ${dateLabel(today)}.`,
  pulse: `${stories.length} source-read story${stories.length === 1 ? '' : 'ies'} passed freshness, relevance, duplication, and language checks.`,
  outlook: await industryOutlook(stories),
  stories
};
await mkdir(archiveDir, { recursive: true });
await writeFile(path.join(archiveDir, 'edition.json'), JSON.stringify(edition, null, 2));
await writeFile(path.join(archiveDir, 'index.html'), pageShell({ title: dateLabel(today), description: edition.dek, active: 'home', body: editionBody(edition), root: '../../' }));
await writeFile(path.join(root, 'index.html'), pageShell({ title: 'Today', description: edition.dek, active: 'home', body: editionBody(edition) }));
const dates = (await readdir(path.join(root, 'Archive'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
const editions = await Promise.all(dates.map(async date => JSON.parse(await readFile(path.join(root, 'Archive', date, 'edition.json'), 'utf8'))));
await writeFile(path.join(root, 'archive.html'), pageShell({ title: 'Archive', description: 'Past The Compute Chronicles editions', active: 'archive', body: archiveBody(editions) }));
console.log(`Published ${today} with ${stories.length} fully reviewed stories.`);
