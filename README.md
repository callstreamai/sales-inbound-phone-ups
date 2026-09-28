# Sales Inbound Phone Ups

Bland-compatible API for dealership sales inbound calls: searches the dealer's own website inventory and submits an ADF lead email to the dealer's CRM. One deployment serves many dealers; each dealer is a config entry.

## Endpoints (all POST except where noted, bearer auth with `WEBHOOK_SECRET`)

| Endpoint | Purpose |
|---|---|
| `GET /health` | Mode, config flags, per-dealer inventory cache status |
| `/call/start` | Dealer context for the call: name, brand, sales open/closed, transfer number, inventory readiness |
| `/inventory/search` | Ranked matches from the cached snapshot; spoken-ready strings and flat `vehicle_*` fields for the top 3 |
| `/inventory/vehicle` | One unit by stock or VIN, live-checked against the dealer sitemap |
| `/lead/submit` | Builds ADF XML, emails it via Resend, returns `lead_sent` and a warm-transfer summary. Idempotent per `call_id` |
| `/adf/preview` | Returns the ADF XML for a body without sending |
| `GET /inventory/status` | Capture diagnostics per dealer |
| `/inventory/refresh?wait=1` | Force a Browserless capture now |
| `GET /inventory/sample?dealer_id=` | First N cached vehicles |
| `/inventory/seed` | Load vehicles into the cache by hand (testing) |

Every request resolves the dealer by `dealer_id`, or by `to` (the number the caller dialed) matched against `inbound_numbers`.

## How inventory works

Dealer sites (DealerOn, Dealer.com) render inventory client-side. A background job opens the new and used search pages in Browserless, captures the JSON the page fetches, normalizes it (`src/inventory/normalize.js`), and caches it per dealer. Refresh interval: `INVENTORY_REFRESH_MINUTES` (default 45). Calls only ever read the cache, so search answers in milliseconds. If a capture fails, the previous snapshot is kept and `/health` reports the error.

## Lead delivery

`LEAD_MODE=safe` (default) sends every ADF to `SAFE_LEAD_EMAIL` with `[TEST]` in the subject, whatever the dealer config says. `LEAD_MODE=live` sends to the dealer's `adf_email`. `success` is true only when Resend accepted the message; the pathway must not tell the caller a lead was sent otherwise.

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `WEBHOOK_SECRET` | yes | Bearer token Bland sends |
| `RESEND_API_KEY` | yes | Resend API key |
| `LEAD_FROM_EMAIL` | yes | Verified sender, e.g. `leads@alphadriveai.com` |
| `SAFE_LEAD_EMAIL` | safe mode | Test inbox |
| `LEAD_ARCHIVE_BCC` | no | BCC copy of every lead |
| `LEAD_MODE` | no | `safe` or `live` (default safe) |
| `BROWSERLESS_API_KEY` | yes | Inventory capture is disabled without it |
| `BROWSERLESS_REGION` | no | default `production-sfo.browserless.io` |
| `INVENTORY_REFRESH_MINUTES` | no | default 45 |
| `DEALERS_JSON` | no | Overrides `config/dealers.json` |

## Adding a dealer

Add an entry to `config/dealers.json` (or `DEALERS_JSON`): `dealer_id`, `name`, `brand`, `platform` (`dealeron` or `dealercom`), `website`, `adf_email`, `sales_transfer_number`, `sales_hours`, `timezone`, `inbound_numbers`. Override `srp` paths or `pagination` only if the site deviates from the platform defaults in `src/adapters/platforms.js`.
