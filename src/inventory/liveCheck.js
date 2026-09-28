// Cheap real-time "is this VIN still listed" check: fetch the dealer's sitemap (plain HTML
// or XML, no JavaScript) and look for the VIN. Used only for one specific unit, never for
// search.
export async function vinStillListed(dealer, vin) {
  const url = dealer.live_check_url;
  if (!url || !vin) return { checked: false, listed: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.LIVE_CHECK_TIMEOUT_MS || 8000));
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlphaDriveAI/1.0)' } });
    if (!res.ok) return { checked: false, listed: null, http: res.status };
    const text = await res.text();
    return { checked: true, listed: text.toUpperCase().includes(String(vin).toUpperCase()) };
  } catch (err) {
    return { checked: false, listed: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
