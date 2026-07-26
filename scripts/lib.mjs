export const SITE_NAME = 'The Compute Chronicles';
export const RECIPIENT = 'cpahl315@gmail.com';

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

export function dateLabel(isoDate) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'America/Chicago' }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function pageShell({ title, description, active, body }) {
  const navigation = `<nav aria-label="Primary"><a href="./index.html" ${active === 'home' ? 'aria-current="page"' : ''}>Today</a><a href="./archive.html" ${active === 'archive' ? 'aria-current="page"' : ''}>Archive</a></nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escapeHtml(description)}"><title>${escapeHtml(title)} · ${SITE_NAME}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="./assets/site.css"></head><body><header class="site-header"><a class="wordmark" href="./index.html"><span class="mark">TC</span><span>The Compute <em>Chronicles</em></span></a>${navigation}</header><main>${body}</main><footer><span>Daily AI & data-center intelligence.</span><span>Published at 8:00 AM CT</span></footer></body></html>`;
}

export function relativeRoot(path) {
  return path.includes('/Archive/') ? '../../' : './';
}
