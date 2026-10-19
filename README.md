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


### Multiple models of interest

`POST /inventory/search` accepts `models: ["Corolla", "4Runner"]` (up to
8 models) or the existing `model: "Corolla, 4Runner"` field. Spoken variants
such as "four runner" and conjunctions such as "Corolla or 4Runner" work too.
Explicit `models` takes precedence over `model`; narrative
`vehicle_interest_text` is used only when neither explicit field is supplied.
Send the complete current list on each request. To narrow to one model, omit
`models` (or send an empty list) and set `model` to that model. Searches are
stateless: prior interests are not restored from conversation history.

Shared filters (condition, year, color, budget, etc.) apply separately to each
model. The response includes:

- `multi_model`, `requested_models`: whether this is a grouped search and its models.
- `model_results`: one response per model, including zero-match groups, separate
  exact/alternative counts, availability flags, and up to three vehicles.
- `model_results_json`: the same groups as a string for Bland variable mapping.
- `results_spoken`: short per-model counts followed by which model to review first.
- Existing `vehicle_1` through `vehicle_3` fields: a round-robin shortlist, so a
  larger result group cannot fill all three slots before another model appears.

`match_count`, `exact_match_count`, and `alternative_count` aggregate the groups.
Overall `status` is `partial_match` when any model has only alternatives or no
matches while another has matches. Read each group's status and unmet criteria;
do not describe all returned vehicles as exact matches. For more than three
models, use the grouped response to access models outside the three flat slots.
Single-model searches clear the grouped fields and retain their existing response
shape. A matched stock number or VIN takes precedence over grouped searching.
Bland must retain the caller's full interest list and map the grouped fields for
follow-up conversation; this API does not maintain call state.
