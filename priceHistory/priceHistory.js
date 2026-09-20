/**
 * priceHistory.js
 * ---------------
 * Sends a daily price snapshot to the backend, which writes it to disk as:
 *
 *   history/DSE_prices_YYYY-MM-DD.json
 *
 * One file per trading day. Closed days (all LTP = 0) are skipped
 * on both the client and the server.
 *
 * Public API
 * ----------
 *   saveDailySnapshot(stocks)  – call after every successful data load
 */

const API_BASE = '/api';

/**
 * POST today's snapshot to the server.
 *
 * @param {Array} stocks – raw stock objects from the DSE API.
 *   Each must have: .code, .ltp, .ycp, .high, .low
 */
export async function saveDailySnapshot(stocks) {
  if (!stocks || stocks.length === 0) return;

  // Client-side closed-market guard (server checks too, but fail fast)
  const allZero = stocks.every(s => Number(s.ltp) === 0);
  if (allZero) {
    console.log('[priceHistory] All LTPs are 0 — skipping save (market closed).');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/save-snapshot`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ stocks }),
    });

    const data = await res.json();

    if (data.skipped) {
      console.log('[priceHistory] Server skipped save:', data.reason);
    } else if (data.saved) {
      console.log(`[priceHistory] ✓ Saved ${data.count} stocks → ${data.file}`);
    } else {
      console.warn('[priceHistory] Unexpected response:', data);
    }
  } catch (err) {
    // Never crash the main app — history saving is best-effort
    console.warn('[priceHistory] Could not save snapshot:', err.message);
  }
}
