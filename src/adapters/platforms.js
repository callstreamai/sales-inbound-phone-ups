// Per-platform defaults. A dealer entry can override any of these under "srp" / "pagination".
export const PLATFORMS = {
  dealeron: {
    srp: { new: '/searchnew.aspx', used: '/searchused.aspx' },
    // DealerOn Cosmos SRP pages are numbered with ?pt=N starting at 1.
    pagination: { param: 'pt', start: 1, mode: 'page' },
    usedIncludesCertified: true,
  },
  dealercom: {
    srp: { new: '/new-inventory/index.htm', used: '/used-inventory/index.htm' },
    // Dealer.com pages by result offset: ?start=0, 18, 36 ...
    pagination: { param: 'start', start: 0, mode: 'offset' },
    usedIncludesCertified: true,
  },
};

export function platformFor(dealer) {
  const base = PLATFORMS[dealer.platform];
  if (!base) throw new Error(`Unsupported platform ${dealer.platform}`);
  return {
    srp: { ...base.srp, ...(dealer.srp || {}) },
    pagination: { ...base.pagination, ...(dealer.pagination || {}) },
    maxPages: dealer.max_pages || 25,
  };
}

export function pageUrl(dealer, condition, index, perPage) {
  const p = platformFor(dealer);
  const url = new URL(p.srp[condition], dealer.website);
  if (index > 0) {
    const value = p.pagination.mode === 'offset' ? p.pagination.start + index * perPage : p.pagination.start + index;
    url.searchParams.set(p.pagination.param, String(value));
  }
  return url.toString();
}
