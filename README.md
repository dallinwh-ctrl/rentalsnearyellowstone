# Rentals Near Yellowstone

Direct booking site for the homes Fresh Pine Property Services manages, at rentalsnearyellowstone.com.

Guests browse the homes, see live availability and prices, and pay on Hospitable's secure checkout.
Every booking lands in Hospitable like any other direct booking.

## How it works

- `scripts/build.mjs` builds a static page for every home into `dist/`. With `HOSPITABLE_TOKEN` set it pulls
  homes, photos and 5-star reviews from the Hospitable API; without it, it uses `data/sample-properties.json`.
  Only the town and state of each home are used. Street addresses never reach the site.
- `functions/api/*` are Cloudflare Pages Functions that call Hospitable with the secret token:
  - `GET /api/search` checks every home for a date range (home page search)
  - `GET /api/calendar` gives day-by-day availability for the date picker
  - `POST /api/quote` gets the exact price and a Hospitable checkout link
- `data/overrides.json` sets each home's title and URL on this site, or hides it (`"hidden": true`).
  A home added in Hospitable later shows up automatically using its public name.
- `data/site.json` holds the phone, email, review line and the "why book direct" text.
- A GitHub Action rebuilds the site nightly so new photos and reviews appear.

## Hosting (Cloudflare Workers)

The site runs as one Cloudflare Worker (`wrangler.jsonc`): `worker/index.js` answers `/api/*` with the handlers in
`functions/api/`, and everything else is served from the static files in `dist/`. Pushing to `main` deploys
automatically (Workers Builds), and `wrangler deploy` runs `npm run build` first.

In the Cloudflare dashboard, on the rentalsnearyellowstone Worker:

1. Settings → Variables and Secrets: `HOSPITABLE_TOKEN` (type Secret), a Hospitable personal access token
   (Hospitable → Apps → API access). The live prices, calendar and quotes use this.
2. Settings → Build → Variables and secrets: the same `HOSPITABLE_TOKEN`, so each build pulls real photos,
   descriptions and reviews.
3. Settings → Domains & Routes: add `www.rentalsnearyellowstone.com` and `rentalsnearyellowstone.com` as custom
   domains (the Worker redirects the bare domain to www). This needs the domain's DNS on Cloudflare.
4. Nightly refresh: create a Cloudflare API token that can edit Workers, or a deploy hook if available, and save it
   for `.github/workflows/nightly-rebuild.yml` (`CF_DEPLOY_HOOK`).

## Local preview

```
npm run build          # sample data
HOSPITABLE_TOKEN=... npm run build   # live data
npx wrangler dev                     # serves the site and /api (put HOSPITABLE_TOKEN=... in .dev.vars)
```
