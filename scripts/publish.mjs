import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SITE_NAME, dateLabel, escapeHtml, pageShell } from './lib.mjs';

const root = process.cwd();
const zone = 'America/Chicago';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(new Date()));
const force = process.env.FORCE_PUBLISH === 'true';
const siteUrl = (process.env.SITE_URL || 'https://YOUR-GITHUB-HANDLE.github.io/compute-chronicles').replace(/\/$/, '');
const archiveDir = path.join(root, 'Archive', today);

if (!force && hour !== 8) {
  console.log(`Not publishing: current ${zone} hour is ${hour}, not 8.`);
  process.exit(0);
}

try {
  await readFile(path.join(archiveDir, 'edition.json'));
  if (process.env.REBUILD_EXISTING === 'true') console.log(`Rebuilding existing ${today} edition.`);
  else { console.log(`Edition already exists for ${today}.`); process.exit(0); }
} catch {}

const queries = [
  'artificial intelligence models companies',
  'Nvidia AMD AI chips data center',
  'hyperscaler data center capacity investment',
  'data center power cooling networking',
  'AI infrastructure partnership financing policy'
];

function decode(text = '') { return text.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function tag(item, name) { return decode(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim(); }
function cleanTitle(title) { return title.replace(/\s+-\s+[^-]{2,80}$/, '').trim(); }

async function collectStories() {
  const requests = queries.map(query => fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`).then(response => response.ok ? response.text() : '').catch(() => ''));
  const feeds = await Promise.all(requests);
  const seen = new Set();
  const stories = [];
  for (const feed of feeds) {
    for (const item of feed.match(/<item>[\s\S]*?<\/item>/gi) || []) {
      const title = cleanTitle(tag(item, 'title'));
      const link = tag(item, 'link');
      const source = tag(item, 'source') || 'Source';
      const key = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 85);
      if (!title || !link || seen.has(key) || title.length < 24) continue;
      seen.add(key);
      stories.push({ title, link, source, summary: `Why it matters: ${title} is part of the fast-moving AI and digital-infrastructure cycle. Open the original reporting for the full context and primary details.` });
    }
  }
  return stories.slice(0, 10);
}

async function enrich(stories) {
  if (!process.env.OPENAI_API_KEY || !stories.length) return stories;
  const prompt = `You are the editor of The Compute Chronicles, a concise daily AI and data-center briefing. Rewrite each supplied news headline into a factual 30-45 word "Why it matters" summary. Do not invent facts. Return JSON only: {"stories":[{"summary":"..."}]}, retaining order. Headlines:\n${stories.map((story, index) => `${index + 1}. ${story.title}`).join('\n')}`;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-5-mini', input: prompt, text: { format: { type: 'json_object' } } }) });
    const result = await response.json();
    const text = result.output_text || result.output?.flatMap(item => item.content || []).map(item => item.text || '').join('');
    const rewritten = JSON.parse(text).stories;
    return stories.map((story, index) => ({ ...story, summary: rewritten[index]?.summary || story.summary }));
  } catch (error) { console.warn(`AI summary unavailable: ${error.message}`); return stories; }
}

function storyMarkup(story, index) { return `<article class="story"><div class="story-number">${String(index + 1).padStart(2, '0')}</div><div><h2>${escapeHtml(story.title)}</h2><p>${escapeHtml(story.summary)}</p><a class="source" href="${escapeHtml(story.link)}" target="_blank" rel="noopener noreferrer">Read original reporting · ${escapeHtml(story.source)}</a></div></article>`; }
function editionBody(edition) { return `<section class="hero"><div class="eyebrow">${dateLabel(edition.date)} · Daily briefing</div><h1>${escapeHtml(edition.headline)}</h1><p class="dek">${escapeHtml(edition.dek)}</p></section><section class="market-pulse"><strong>MARKET PULSE</strong><span>${escapeHtml(edition.pulse)}</span></section><section><h2 class="section-title">Today’s signal</h2>${edition.stories.length ? edition.stories.map(storyMarkup).join('') : '<p class="dek">No material items cleared today’s editorial threshold. The previous edition remains available in the archive.</p>'}</section>`; }
function archiveBody(editions) { return `<section class="archive-hero"><div class="eyebrow">Every daily edition</div><h1>The archive.</h1><p class="dek">A durable record of the AI and infrastructure signals that moved the market.</p></section><ol class="archive-list">${editions.map(edition => `<li><a href="./Archive/${edition.date}/index.html"><span class="meta">${dateLabel(edition.date)}</span><div><h2>${escapeHtml(edition.headline)}</h2><p>${escapeHtml(edition.dek)}</p></div><span class="arrow">↗</span></a></li>`).join('')}</ol>`; }

const rawStories = await collectStories();
if (!rawStories.length) throw new Error('No source feeds were available; preserving the existing live edition.');
const stories = await enrich(rawStories);
const edition = { date: today, headline: 'The compute buildout keeps widening.', dek: `A concise scan of the AI, silicon, cloud, and infrastructure developments that matter this ${dateLabel(today)}.`, pulse: `${stories.length} material signals across AI, semiconductors, cloud capacity, and physical infrastructure.`, stories };
await mkdir(archiveDir, { recursive: true });
await writeFile(path.join(archiveDir, 'edition.json'), JSON.stringify(edition, null, 2));
const archivePage = pageShell({ title: dateLabel(today), description: edition.dek, active: 'home', body: editionBody(edition) }).replaceAll('./assets/', '../../assets/').replaceAll('./index.html', '../../index.html').replaceAll('./archive.html', '../../archive.html');
await writeFile(path.join(archiveDir, 'index.html'), archivePage);
await writeFile(path.join(root, 'index.html'), pageShell({ title: 'Today', description: edition.dek, active: 'home', body: editionBody(edition) }));
const dates = (await readdir(path.join(root, 'Archive'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
const editions = await Promise.all(dates.map(async date => JSON.parse(await readFile(path.join(root, 'Archive', date, 'edition.json'), 'utf8'))));
await writeFile(path.join(root, 'archive.html'), pageShell({ title: 'Archive', description: 'Past Compute Current editions', active: 'archive', body: archiveBody(editions) }));
console.log(`Published ${today} with ${stories.length} stories.`);
