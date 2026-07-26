document.addEventListener('DOMContentLoaded', async () => {
  const ticker = document.querySelector('[data-market-url]');
  if (!ticker) return;
  const status = ticker.querySelector('[data-market-status]');
  const prices = ticker.querySelector('[data-market-prices]');
  const note = ticker.querySelector('[data-market-note]');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  try {
    const response = await fetch(`${ticker.dataset.marketUrl}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('No current market snapshot');
    const data = await response.json();
    if (!Array.isArray(data.prices) || !data.prices.length) throw new Error('Market snapshot has no prices');
    const updated = data.refreshedAt ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date(data.refreshedAt)) : 'unknown time';
    const open = data.marketState === 'open';
    status.textContent = open ? `U.S. market open · updated ${updated}` : `Latest verified close · ${updated}`;
    ticker.classList.toggle('market-open', open);
    prices.innerHTML = data.prices.map(item => {
      const positive = Number(item.change) >= 0;
      const sign = positive ? '+' : '−';
      return `<div class="ticker-quote"><strong>${item.symbol}</strong><span>${money.format(item.price)}</span><em class="${positive ? 'up' : 'down'}">${sign}${money.format(Math.abs(item.change))} (${sign}${Math.abs(item.changePercent).toFixed(2)}%)</em></div>`;
    }).join('');
    note.textContent = `Market data via ${data.provider || 'Finnhub'} · last verified ${updated} · informational only, not investment advice.`;
  } catch {
    status.textContent = 'Market data temporarily unavailable';
    note.textContent = 'The most recent price snapshot could not be loaded. Market data via Finnhub; informational only.';
  }
});
