import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'data', 'market.json');
const symbols = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];
if (!process.env.FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY is required; retaining the prior market snapshot.');

async function marketOpen() {
  const response = await fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Market-status request failed (${response.status})`);
  const status = await response.json();
  return { state: String(status.isOpen ? 'open' : 'closed'), providerTimestamp: status.t || null };
}
async function quote(symbol) {
  const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Quote request failed for ${symbol} (${response.status})`);
  const data = await response.json();
  if (!Number.isFinite(data.c) || !Number.isFinite(data.pc)) throw new Error(`Quote data unavailable for ${symbol}`);
  return { symbol, price: data.c, change: Number(data.d || data.c - data.pc), changePercent: Number(data.dp || ((data.c - data.pc) / data.pc) * 100), providerTimestamp: data.t ? new Date(data.t * 1000).toISOString() : null };
}

const status = await marketOpen();
if (status.state !== 'open') { console.log('U.S. market is closed; retaining the prior verified snapshot.'); process.exit(0); }
const quotes = await Promise.all(symbols.map(quote));
const payload = { provider: 'Finnhub', market: 'US', marketState: status.state, refreshedAt: new Date().toISOString(), prices: quotes };
await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Updated ${quotes.length} market quotes.`);
