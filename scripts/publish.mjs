import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SITE_NAME, dateLabel, escapeHtml, pageShell } from './lib.mjs';

const root = process.cwd();
const zone = 'America/Chicago';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(new Date()));
const force = process.env.FORCE_PUBLISH === 'true';
const maxAgeHours = 36;
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

function decode(text = '') { return text.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function tag(item, name) { return decode(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim(); }
function cleanTitle(title) { return title.replace(/\s+-\s+[^-]{2,80}$/, '').trim(); }
function cleanDescription(description) {
  return decode(description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 650);
}
function storyContext(title) {
  const text = title.toLowerCase();
  if (/hack|security|containment|breach|rogue/.test(text)) return ['The headline turns model safety from an abstract alignment discussion into an operational risk for AI buyers. Security teams will want evidence that evaluation environments, tool access, and model permissions are segmented before allowing autonomous agents near production systems.', 'Look for a technical post-mortem: how the models obtained access, whether the reported behavior was reproduced, and which containment controls OpenAI and other labs change afterward.'];
  if (/open.?weight|open.?source|open.*model|chinese ai|restriction/.test(text)) return ['Open and lower-cost models widen the set of companies that can experiment with AI without committing to a single hosted platform. That can shift inference demand toward self-managed deployments, regional clouds, and vendors that compete on serving cost rather than proprietary model access.', 'Watch for enterprise adoption outside China, benchmark results on real workloads, and any restrictions that determine whether model weights, APIs, or optimized hardware stacks can reach U.S. customers.'];
  if (/brookfield|bloom energy|power partnership/.test(text)) return ['The fivefold expansion is a financing signal for distributed power at AI sites. It suggests developers are willing to pay for faster-to-deploy generation when grid interconnection schedules are too slow for planned compute capacity.', 'Watch for named sites, contracted megawatts, the mix of fuel-cell versus grid power, and whether project financing converts into equipment orders and operating capacity.'];
  if (/debt|financial stability|financing/.test(text)) return ['The financing question is becoming central to the AI buildout: debt can accelerate infrastructure deployment, but it also leaves projects exposed if utilization, pricing, or power availability fails to meet underwriting assumptions.', 'Watch for lender concentration, leverage terms, and whether regulators begin requesting more disclosure around AI-infrastructure credit exposure.'];
  if (/kill switch|\bfrontier.*\bbill\b|\bai companies.*\bbill\b|governance|regulat|policy/.test(text)) return ['This frames frontier-model governance as an engineering requirement rather than a voluntary principle. A mandated shutdown mechanism could add compliance work for model developers and create a new audit market around incident response and access control.', 'Watch for the legislation’s model-capability threshold, enforcement agency, and whether cloud providers inherit any responsibility for hosting or monitoring covered systems.'];
  if (/nvidia|\bchips?\b|semiconductor|gpu|amd|intel/.test(text)) return ['The chip comparison matters because model builders increasingly optimize around total system cost—not just accelerator performance. Pricing, software maturity, memory supply, and networking compatibility determine whether alternative silicon can actually win data-center deployments.', 'Watch for cloud-instance availability, customer benchmarks, and management guidance on accelerator supply; those are stronger indicators than a short-term share-price move.'];
  if (/amazon|layoff|job|workforce/.test(text)) return ['Amazon can cut inside an AI unit while still expanding infrastructure spending, so the key signal is portfolio concentration rather than a retreat from AI. The company appears to be choosing which research paths it believes can reach customers fastest.', 'Watch for AWS re:Invent announcements, Bedrock roadmap changes, and any shift in Amazon’s disclosed capex or partner strategy.'];
  if (/data center|power|cooling|network|capacity|hyperscaler/.test(text)) return ['The story speaks to the physical bottleneck behind AI growth: a model launch only translates into revenue if there is power, cooling, network fabric, and commissioned capacity behind it. Those constraints can reshape where workloads are built and priced.', 'Watch for signed power agreements, construction milestones, utility interconnection dates, and lead-time commentary from cooling and networking suppliers.'];
  return ['This is a signal about where AI commercialization is gaining—or losing—momentum. The practical question is whether the development changes deployment economics, customer adoption, or the amount of infrastructure needed to support the next wave of usage.', 'Watch for named customers, budget commitments, partner announcements, and timelines that convert the headline into an observable business outcome.'];
}
function storyTheme(title) {
  const text = title.toLowerCase();
  if (/hack|security|containment|breach|rogue/.test(text)) return 'model-security';
  if (/open.?weight|open.?source|open.*model|chinese ai|restriction/.test(text)) return 'open-model-policy';
  if (/kill switch|frontier.*bill/.test(text)) return 'frontier-policy';
  if (/brookfield|bloom energy|power partnership/.test(text)) return 'ai-power-financing';
  return '';
}
function fallbackSummary(title, happened) {
  const [why, watch] = storyContext(title);
  return `What happened: ${happened}\n\nWhy it matters: ${why}\n\nWhat to watch: ${watch}`;
}
function articleDescription(html) {
  for (const meta of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/(?:name|property)=["'](?:description|og:description)["']/i.test(meta)) continue;
    const content = meta.match(/content=["']([\s\S]*?)["']/i)?.[1];
    if (content) return cleanDescription(content);
  }
  return '';
}
async function sourceBrief(link) {
  try {
    const response = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    return response.ok ? articleDescription(await response.text()) : '';
  } catch { return ''; }
}

async function collectStories() {
  const requests = queries.map(query => fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=en-US&gl=US&ceid=US:en`).then(response => response.ok ? response.text() : '').catch(() => ''));
  const feeds = await Promise.all(requests);
  const seen = new Set();
  const themes = new Set();
  const stories = [];
  for (const feed of feeds) {
    for (const item of feed.match(/<item>[\s\S]*?<\/item>/gi) || []) {
      const title = cleanTitle(tag(item, 'title'));
      const link = tag(item, 'link');
      const source = tag(item, 'NewsSource') || tag(item, 'source') || 'Source';
      const brief = cleanDescription(tag(item, 'description'));
      const publishedAt = Date.parse(tag(item, 'pubDate'));
      const key = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 85);
      const theme = storyTheme(title);
      const isFresh = !Number.isFinite(publishedAt) || (publishedAt <= Date.now() && Date.now() - publishedAt <= maxAgeHours * 60 * 60 * 1000);
      if (!title || !link || !isFresh || seen.has(key) || (theme && themes.has(theme)) || title.length < 24) continue;
      seen.add(key);
      if (theme) themes.add(theme);
      const happened = brief || `The report focuses on ${title}.`;
      stories.push({ title, link, source, brief, publishedAt, summary: fallbackSummary(title, happened) });
    }
  }
  const selected = stories.sort((left, right) => right.publishedAt - left.publishedAt).slice(0, 5);
  await Promise.all(selected.map(async story => {
    const publishedDescription = await sourceBrief(story.link);
    if (publishedDescription && publishedDescription.length > 45 && !/aggregated from sources all over the world/i.test(publishedDescription)) {
      story.brief = publishedDescription;
      story.summary = fallbackSummary(story.title, publishedDescription);
    }
  }));
  return selected;
}

async function enrich(stories) {
  if (!process.env.OPENAI_API_KEY || !stories.length) return stories;
  const prompt = `You are the editor of The Compute Chronicles. For every supplied news item, write a factual 90-130 word briefing for an informed reader. Use exactly three compact paragraphs labelled "What happened:", "Why it matters:", and "What to watch:". Use only the supplied headline and source blurb; do not invent facts, numbers, dates, or quotations. Return JSON only: {"stories":[{"summary":"..."}]}, retaining order. Items:\n${stories.map((story, index) => `${index + 1}. HEADLINE: ${story.title}\nSOURCE: ${story.source}\nBLURB: ${story.brief || 'No source blurb supplied.'}`).join('\n\n')}`;
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

function storyMarkupV2(story, index) {
  const sections = story.summary.split(/\n\s*\n/).filter(Boolean).map(section => {
    const match = section.match(/^(What happened|Why it matters|What to watch):\s*([\s\S]*)$/i);
    const label = match?.[1] || 'Briefing';
    const copy = match?.[2] || section;
    return `<div class="detail"><span>${escapeHtml(label)}</span><p>${escapeHtml(copy)}</p></div>`;
  }).join('');
  return `<article class="story"><div class="story-number">${String(index + 1).padStart(2, '0')}</div><div class="story-main"><div class="story-heading"><h2>${escapeHtml(story.title)}</h2><span class="story-source">${escapeHtml(story.source)}</span></div><div class="story-details">${sections}</div><a class="source" href="${escapeHtml(story.link)}" target="_blank" rel="noopener noreferrer">Open original reporting <b>↗</b></a></div></article>`;
}

function editionBodyV2(edition) { return `<section class="hero"><div class="eyebrow">${dateLabel(edition.date)} · Daily briefing</div><h1>${escapeHtml(edition.headline)}</h1><p class="dek">${escapeHtml(edition.dek)}</p></section><section class="visual-strip"><figure><img src="./assets/data-center-hero.png" alt="Modern AI data center with liquid cooling"><figcaption>Inside the physical backbone of the AI buildout.</figcaption></figure><figure><img src="./assets/ai-chip-detail.png" alt="AI accelerator chip and fiber optics"><figcaption>Compute, interconnect, and the race for capacity.</figcaption></figure></section><section class="market-pulse"><strong>MARKET PULSE</strong><span>${escapeHtml(edition.pulse)}</span></section><section><h2 class="section-title">Today’s signal</h2>${edition.stories.length ? edition.stories.map(storyMarkupV2).join('') : '<p class="dek">No material items cleared today’s editorial threshold. The previous edition remains available in the archive.</p>'}</section>`; }

function editionBodyV3(edition) {
  const visuals = `<section class="visual-strip" style="display:grid;grid-template-columns:1.6fr .8fr;gap:18px;margin:0 0 40px"><figure style="margin:0;position:relative;overflow:hidden;background:#112a68"><img src="./assets/data-center-hero.png" alt="Modern AI data center with liquid cooling" style="width:100%;height:300px;display:block;object-fit:cover"><figcaption style="margin:0;padding:12px 15px;background:#fff;color:#101a2e;font:500 11px 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.07em">Inside the physical backbone of the AI buildout.</figcaption></figure><figure style="margin:0;overflow:hidden;background:#ffdf56"><img src="./assets/ai-chip-detail.png" alt="AI accelerator chip and fiber optics" style="width:100%;height:300px;display:block;object-fit:cover"><figcaption style="margin:0;padding:12px 15px;background:#fff;color:#101a2e;font:500 11px 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.07em">Compute, interconnect, and capacity.</figcaption></figure></section>`;
  return `<section class="hero"><div class="eyebrow">${dateLabel(edition.date)} · Daily briefing</div><h1>${escapeHtml(edition.headline)}</h1><p class="dek">${escapeHtml(edition.dek)}</p></section>${visuals}<section class="market-pulse"><strong>MARKET PULSE</strong><span>${escapeHtml(edition.pulse)}</span></section><section><h2 class="section-title">Today’s signal</h2>${edition.stories.length ? edition.stories.map(storyMarkupV2).join('') : '<p class="dek">No material items cleared today’s editorial threshold. The previous edition remains available in the archive.</p>'}</section>`;
}

function briefingSummary(story) {
  const [why, watch] = storyContext(story.title);
  return `${story.brief || story.title} ${why} Watch next for ${watch.replace(/^Watch for /i, '').replace(/^Watch whether /i, '')}`;
}
function storyMarkupTopFive(story, index) {
  return `<article class="story"><div class="story-number">${String(index + 1).padStart(2, '0')}</div><div class="story-main"><div class="story-heading"><h2>${escapeHtml(story.title)}</h2><span class="story-source">${escapeHtml(story.source)}</span></div><p style="color:#42526a;font-size:1rem;line-height:1.72;max-width:850px;margin:0 0 20px">${escapeHtml(briefingSummary(story))}</p><a class="source" href="${escapeHtml(story.link)}" target="_blank" rel="noopener noreferrer">Read source <b>↗</b></a></div></article>`;
}
function trendsPassage(stories) {
  const topics = stories.map(story => story.title).join(' ').toLowerCase();
  const policy = /china|export|open.?weight|policy|regulat/.test(topics) ? 'Policy and cross-border model access remain a live variable, especially where open models, advanced chips, and cloud capacity intersect.' : 'Geopolitical exposure remains material through chip-export controls, regional power policy, and the location of advanced manufacturing.';
  return `The day’s signal is that AI demand is increasingly constrained by the physical and financial systems around the models. Accelerator supply is only one bottleneck: high-bandwidth memory, advanced packaging, optical networking, transformers, switchgear, liquid-cooling equipment, and utility interconnections can each slow a new build. ${policy} As projects grow, financing discipline matters too—utilization assumptions, power contracts, and construction schedules now influence which announced data-center capacity actually reaches service.`;
}
function editionBodyV4(edition) {
  const visuals = `<section class="visual-strip" style="display:grid;grid-template-columns:1.6fr .8fr;gap:18px;margin:0 0 40px"><figure style="margin:0;position:relative;overflow:hidden;background:#112a68"><img src="./assets/data-center-hero.png" alt="Modern AI data center with liquid cooling" style="width:100%;height:300px;display:block;object-fit:cover"><figcaption style="margin:0;padding:12px 15px;background:#fff;color:#101a2e;font:500 11px 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.07em">Inside the physical backbone of the AI buildout.</figcaption></figure><figure style="margin:0;overflow:hidden;background:#ffdf56"><img src="./assets/ai-chip-detail.png" alt="AI accelerator chip and fiber optics" style="width:100%;height:300px;display:block;object-fit:cover"><figcaption style="margin:0;padding:12px 15px;background:#fff;color:#101a2e;font:500 11px 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.07em">Compute, interconnect, and capacity.</figcaption></figure></section>`;
  return `<section class="hero"><div class="eyebrow">${dateLabel(edition.date)} · Top five daily briefing</div><h1>${escapeHtml(edition.headline)}</h1><p class="dek">Five fresh developments in AI and data centers, plus the constraints shaping what happens next.</p></section>${visuals}<section class="market-pulse"><strong>MARKET PULSE</strong><span>${escapeHtml(edition.pulse)}</span></section><section><h2 class="section-title">Top five stories</h2>${edition.stories.map(storyMarkupTopFive).join('')}</section><section style="background:#fff4b5;border:1px solid #f0ca40;padding:30px;margin:30px 0 60px"><div class="eyebrow" style="color:#8a5a00">Industry outlook</div><h2 style="font-size:clamp(1.7rem,3vw,2.35rem);letter-spacing:-.05em;margin:10px 0 12px">What the market is telling us.</h2><p style="color:#3e4651;line-height:1.75;margin:0;max-width:900px">${escapeHtml(trendsPassage(edition.stories))}</p></section>`;
}

const rawStories = await collectStories();
if (!rawStories.length) throw new Error('No source feeds were available; preserving the existing live edition.');
const stories = await enrich(rawStories);
const edition = { date: today, headline: 'Five signals shaping the AI buildout.', dek: `A concise scan of the newest AI and data-center developments for ${dateLabel(today)}.`, pulse: `${stories.length} fresh, material signals across AI, semiconductors, cloud capacity, and physical infrastructure.`, stories };
await mkdir(archiveDir, { recursive: true });
await writeFile(path.join(archiveDir, 'edition.json'), JSON.stringify(edition, null, 2));
const archivePage = pageShell({ title: dateLabel(today), description: edition.dek, active: 'home', body: editionBodyV4(edition) }).replaceAll('./assets/', '../../assets/').replaceAll('./index.html', '../../index.html').replaceAll('./archive.html', '../../archive.html');
await writeFile(path.join(archiveDir, 'index.html'), archivePage);
await writeFile(path.join(root, 'index.html'), pageShell({ title: 'Today', description: edition.dek, active: 'home', body: editionBodyV4(edition) }));
const dates = (await readdir(path.join(root, 'Archive'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
const editions = await Promise.all(dates.map(async date => JSON.parse(await readFile(path.join(root, 'Archive', date, 'edition.json'), 'utf8'))));
await writeFile(path.join(root, 'archive.html'), pageShell({ title: 'Archive', description: 'Past Compute Current editions', active: 'archive', body: archiveBody(editions) }));
console.log(`Published ${today} with ${stories.length} stories.`);
