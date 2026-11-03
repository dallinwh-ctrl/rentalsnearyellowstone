# Rentals Near Yellowstone

Direct booking site for the homes Fresh Pine Services manages, at rentalsnearyellowstone.com.

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

## Hosting (Cloudflare Pages)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → this repository.
2. Build command `npm run build`, output directory `dist`.
3. Settings → Environment variables (Production and Preview): `HOSPITABLE_TOKEN` = a Hospitable
   personal access token (Hospitable → Apps → API access), marked as a secret.
4. Settings → Builds → Deploy hooks: create one, and save its URL as the GitHub repository secret
   `CF_DEPLOY_HOOK` for the nightly rebuild.
5. Custom domains: add `www.rentalsnearyellowstone.com` and `rentalsnearyellowstone.com`, then set the
   DNS records Cloudflare shows in Squarespace's DNS settings for the domain.

## Local preview

```
npm run build          # sample data
HOSPITABLE_TOKEN=... npm run build   # live data
npx wrangler@3 pages dev dist        # serves the site and the /api functions (put the token in .dev.vars)
```
