// Builds the static site into dist/.
// With HOSPITABLE_TOKEN set, it pulls homes, photos and reviews live from Hospitable.
// Without it, it uses data/sample-properties.json so the site can be previewed anywhere.
import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const SITE = JSON.parse(await readFile(path.join(ROOT, 'data/site.json'), 'utf8'));
const OVERRIDES = JSON.parse(await readFile(path.join(ROOT, 'data/overrides.json'), 'utf8'));
const API = 'https://public.api.hospitable.com/v2';
const TOKEN = process.env.HOSPITABLE_TOKEN;
// Content hashes so browsers pick up new CSS/JS right after a deploy.
const hashOf = async (f) => createHash('sha1').update(await readFile(path.join(ROOT, 'public', f))).digest('hex').slice(0, 10);
const V = { css: await hashOf('styles.css'), js: await hashOf('app.js') };

// ---------- data ----------

async function api(p) {
  const res = await fetch(API + p, { headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' } });
  if (!res.ok) throw new Error(`Hospitable ${p} -> ${res.status}`);
  return res.json();
}

async function loadHomes() {
  if (!TOKEN) {
    console.log('No HOSPITABLE_TOKEN: building from sample data.');
    const props = JSON.parse(await readFile(path.join(ROOT, 'data/sample-properties.json'), 'utf8'));
    return props.map((p) => ({ ...p, images: p.picture ? [{ url: p.picture, thumbnail_url: p.picture, caption: '' }] : [], reviews: [] }));
  }
  const props = [];
  for (let page = 1; ; page++) {
    const body = await api(`/properties?per_page=100&page=${page}`);
    props.push(...body.data);
    if (!body.meta || page >= body.meta.last_page) break;
  }
  const out = [];
  for (const p of props) {
    if (!p.listed) continue;
    const [imgs, revs] = await Promise.all([
      api(`/properties/${p.id}/images`).catch(() => ({ data: [] })),
      api(`/properties/${p.id}/reviews?per_page=30`).catch(() => ({ data: [] })),
    ]);
    // Only city/state leave this script: never a street address.
    out.push({
      id: p.id, name: p.name, public_name: p.public_name, listed: p.listed, picture: p.picture,
      summary: p.summary, description: p.description, amenities: p.amenities, capacity: p.capacity,
      room_details: p.room_details, property_type: p.property_type, room_type: p.room_type,
      checkin: p.checkin, checkout: p.checkout, house_rules: p.house_rules,
      address: { city: p.address?.city, state: p.address?.state },
      images: (imgs.data || []).sort((a, b) => a.order - b.order),
      reviews: (revs.data || []).filter((r) => r.public?.rating >= 5 && (r.public?.review || '').length > 60)
        .slice(0, 6).map((r) => ({ text: r.public.review, platform: r.platform, date: r.reviewed_at })),
    });
  }
  return out;
}

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const town = (h) => (h.address?.city === 'Saint Anthony' ? 'St. Anthony' : h.address?.city) || 'Idaho';
const STATES = { ID: 'Idaho', MT: 'Montana', WY: 'Wyoming' };
const stateCode = (h) => (STATES[h.address?.state] ? h.address.state : 'ID');
const state = (h) => STATES[stateCode(h)];
const place = (h) => `${town(h)}, ${state(h)}`;
// Listing text sometimes shouts ("MINIMAL CELL SERVICE"); show runs of capitals in sentence case without changing the words.
const unshout = (s) => s.replace(/\b[A-Z]{3,}(?:[ \t]+[A-Z]{2,})+\b/g, (m, i) => {
  const low = m.toLowerCase();
  const start = i === 0 || /[.!?:]\s*$/.test(s.slice(0, i)) || /^\s*$/.test(s.slice(0, i));
  return start ? low[0].toUpperCase() + low.slice(1) : low;
});

const AMENITY_LABELS = {
  jacuzzi: 'Hot tub', hot_tub: 'Hot tub', wifi: 'Wifi', bbq: 'BBQ grill', fire_pit: 'Fire pit', fireplace: 'Fireplace',
  washer: 'Washer', dryer: 'Dryer', kitchen: 'Full kitchen', dishwasher: 'Dishwasher', tv: 'TV', ac: 'Air conditioning',
  free_on_premise_parking: 'Free parking', high_chair: 'High chair', crib: 'Crib', board_games: 'Board games',
  sauna: 'Sauna', arcade_machine: 'Arcade machine', ev_charger: 'EV charger', pets_allowed: 'Pets allowed',
  patio: 'Patio', bathtub: 'Bathtub', coffee_maker: 'Coffee maker', heating: 'Heating', lake_access: 'Lake access',
  waterfront: 'Waterfront', mountain_view: 'Mountain view', pool_table: 'Pool table', game_console: 'Game console',
};
const FEATURED = ['jacuzzi', 'hot_tub', 'sauna', 'fire_pit', 'fireplace', 'wifi', 'kitchen', 'washer', 'dryer', 'bbq',
  'ac', 'dishwasher', 'arcade_machine', 'pool_table', 'game_console', 'ev_charger', 'high_chair', 'crib', 'board_games',
  'free_on_premise_parking', 'lake_access', 'waterfront', 'mountain_view', 'patio'];

function highlights(h) {
  const a = new Set(h.amenities || []);
  const seen = new Set();
  const out = [];
  for (const k of FEATURED) {
    if (!a.has(k)) continue;
    const label = AMENITY_LABELS[k];
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

function perk(h) {
  const a = new Set(h.amenities || []);
  if (a.has('sauna') && (a.has('jacuzzi') || a.has('hot_tub'))) return 'Sauna and hot tub';
  if (a.has('jacuzzi') || a.has('hot_tub')) return 'Hot tub';
  if (a.has('lake_access') || a.has('waterfront')) return 'On the water';
  return '';
}

function facts(h) {
  const c = h.capacity || {};
  const parts = [`Sleeps ${c.max}`];
  if (c.bedrooms) parts.push(plural(c.bedrooms, 'bedroom', 'bedrooms'));
  if (c.bathrooms) parts.push(`${c.bathrooms} ${c.bathrooms === 1 ? 'bath' : 'baths'}`);
  return parts.join(' · ');
}

// Listing text -> HTML: blank-line blocks become paragraphs, "-", "•" or "*" lines become bullet lists,
// a short line ending in ":" or with no period before a list becomes a small heading.
function paragraphs(text) {
  const lines = unshout(String(text || '').replace(/\r/g, '')).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim());
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`<ul>${list.map((li) => `<li>${esc(li).replace(/^([A-Z][\w &amp;/'’-]{1,30}):\s/, '<strong>$1:</strong> ')}</li>`).join('')}</ul>`); list = null; } };
  for (const line of lines) {
    if (!line) { close(); continue; }
    const bullet = line.match(/^[-•*]\s*(.+)$/);
    if (bullet) { (list ||= []).push(bullet[1]); continue; }
    close();
    if (line.length <= 40 && !/[.!?]$/.test(line)) out.push(`<h3>${esc(line.replace(/:$/, ''))}</h3>`);
    else out.push(`<p>${esc(line)}</p>`);
  }
  close();
  return out.join('\n');
}

const LOGO = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l-6 9h4l-4 6h12l-4-6h4z"/><path d="M12 18v3"/></svg>`;

function layout({ title, description, canonical, image, body, jsonld, bodyClass = '' }) {
  const url = SITE.url + canonical;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css?v=${V.css}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/">${LOGO}<span>${esc(SITE.name)}</span></a>
    <nav aria-label="Main">
      <a href="/#homes">Homes</a>
      <a href="/#why">Why book direct</a>
      <a href="/#contact">Contact</a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer" id="contact">
  <div class="wrap footer-row">
    <div>
      <p class="footer-brand">${esc(SITE.name)}</p>
      <p>Questions about a stay? Call or text <a href="tel:${esc(SITE.phone_e164)}">${esc(SITE.phone)}</a> or email <a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>.</p>
    </div>
    <div>
      <p>Homes cared for by ${esc(SITE.manager_name)}.</p>
      <p><a href="${esc(SITE.manager_owner_url)}">Own a cabin near Yellowstone? See our management →</a></p>
    </div>
  </div>
</footer>
<script src="/app.js?v=${V.js}" defer></script>
</body>
</html>
`;
}

function card(h) {
  const o = OVERRIDES[h.id] || {};
  const img = h.images?.[0];
  const p = perk(h);
  return `<li class="card" data-id="${esc(h.id)}" data-town="${esc(town(h))}" data-guests="${h.capacity?.max || 1}">
  <a href="/homes/${esc(o.slug)}/">
    <div class="card-img">${img ? `<img src="${esc(img.thumbnail_url || img.url)}" alt="${esc(o.title)}" loading="lazy" width="600" height="450">` : ''}</div>
    <div class="card-body">
      <span class="eyebrow">${esc(town(h))}</span>
      <span class="card-title">${esc(o.title)}</span>
      <span class="card-facts">${esc(facts(h))}</span>
      ${p ? `<span class="card-perk">${esc(p)}</span>` : ''}
      <span class="card-price" hidden></span>
    </div>
  </a>
</li>`;
}

function searchForm(extraClass = '') {
  return `<form class="search ${extraClass}" data-search>
  <label>Check in<input type="date" name="start" required></label>
  <label>Check out<input type="date" name="end" required></label>
  <label>Adults<input type="number" name="adults" min="1" max="30" value="2" inputmode="numeric"></label>
  <label>Children<input type="number" name="children" min="0" max="30" value="0" inputmode="numeric"></label>
  <button type="submit" class="btn">See available homes</button>
</form>`;
}

// ---------- pages ----------

function homePage(homes) {
  const towns = [...new Set(homes.map(town))];
  const places = [...new Set(homes.map(place))];
  const order = ['Island Park', 'West Yellowstone', 'Ashton', 'St. Anthony', 'Newdale'];
  towns.sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  const body = `
<section class="hero">
  <div class="wrap">
    <p class="kicker">${esc(towns.slice(0, 4).join(' · '))}</p>
    <h1>Cabins and homes near Yellowstone, booked direct with the local team.</h1>
    <p class="lede">For couples, families and big groups. Live prices and calendars, and the people who clean and care for each home answer your messages.</p>
    <p class="proof">${esc(SITE.review_line)}</p>
    ${searchForm()}
    <p class="search-status" data-search-status role="status" aria-live="polite"></p>
  </div>
</section>
<section class="wrap section" id="homes">
  <div class="section-head">
    <h2 data-count>Our homes near Yellowstone</h2>
    <div class="chips" role="group" aria-label="Filter by town">
      <button type="button" class="chip" aria-pressed="true" data-town="">All towns</button>
      ${towns.map((t) => `<button type="button" class="chip" aria-pressed="false" data-town="${esc(t)}">${esc(t)}</button>`).join('\n      ')}
    </div>
  </div>
  <ul class="grid" data-grid>
    ${homes.map(card).join('\n')}
  </ul>
  <p class="empty" data-empty hidden>No homes match. Try other dates or towns, or text us at <a href="tel:${esc(SITE.phone_e164)}">${esc(SITE.phone)}</a>.</p>
</section>
<section class="wrap section" id="why">
  <div class="why">
    <div><h3>Book with the people on the ground</h3><p>A locally owned team cleans and checks every home, and answers your questions before and during your stay.</p></div>
    <div><h3>See the full price first</h3><p>Pick your dates and you see the total with cleaning and taxes before you pay, on our secure checkout.</p></div>
    <div><h3>${esc(SITE.direct_perk_title)}</h3><p>${esc(SITE.direct_perk_text)}</p></div>
  </div>
</section>`;
  return layout({
    title: `${SITE.name} | Cabins and Vacation Homes Near Yellowstone`,
    description: `Book cabins and vacation homes near Yellowstone direct: Island Park, West Yellowstone, Ashton and nearby. Live availability and prices.`,
    canonical: '/',
    image: homes[0]?.images?.[0]?.url,
    body,
    jsonld: {
      '@context': 'https://schema.org', '@type': 'LodgingBusiness', name: SITE.name, url: SITE.url,
      telephone: SITE.phone, email: SITE.email,
      areaServed: places.map((t) => ({ '@type': 'City', name: t })),
    },
  });
}

function homeDetail(h) {
  const o = OVERRIDES[h.id];
  const imgs = h.images || [];
  const hl = highlights(h);
  const c = h.capacity || {};
  const reviews = h.reviews || [];
  const rules = h.house_rules || {};
  const body = `
<div class="wrap crumbs"><a href="/#homes">← All homes</a></div>
<section class="wrap gallery n${Math.min(imgs.length, 5) || 1}" aria-label="Photos" data-gallery>
  ${galleryTiles(imgs, o.title)}
</section>
<div class="wrap detail">
  <article class="detail-main">
    <p class="eyebrow">${esc(place(h))}</p>
    <h1>${esc(o.title)}</h1>
    <p class="detail-facts">${esc(facts(h))}${c.beds ? ` · ${plural(c.beds, 'bed', 'beds')}` : ''}</p>
    ${sleepingRooms(h).length ? `<h2>Where you'll sleep</h2><ul class="beds">${sleepingRooms(h).map((r) => `<li><strong>${esc(r.name)}<span class="sr-sep">: </span></strong><span>${esc(r.beds)}</span></li>`).join('')}</ul>` : ''}
    <h2>About this home</h2>
    <div class="prose">${h.summary && h.description && !h.description.startsWith(h.summary.slice(0, 40)) ? paragraphs(h.summary) : ''}${paragraphs(h.description || h.summary)}</div>
    <section class="photos-section" data-photo-section ${imgs.length > 1 ? '' : 'hidden'}>
      <h2>Photos</h2>
      <ul class="photo-grid" data-photo-grid>${photoGrid(imgs, o.title)}</ul>
    </section>
    ${hl.length ? `<h2>What's here</h2><ul class="amenities">${hl.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <h2>Good to know</h2>
    <ul class="rules">
      <li>Check in after ${esc(fmtTime(o.checkin || SITE.checkin || h.checkin))}, check out by ${esc(fmtTime(o.checkout || SITE.checkout || h.checkout))}</li>
      ${rules.pets_allowed === false ? '<li>No pets</li>' : rules.pets_allowed ? '<li>Pets welcome (pet fee may apply)</li>' : ''}
      ${rules.smoking_allowed === false ? '<li>No smoking</li>' : ''}
      ${rules.events_allowed === false ? '<li>No parties or events</li>' : ''}
      <li>Exact address sent after booking</li>
    </ul>
    ${reviews.length ? `<h2>What guests say</h2><ul class="reviews">${reviews.slice(0, 4).map((r) => `<li><blockquote>${esc(r.text)}</blockquote><p class="review-meta">Guest review on ${esc(r.platform === 'vrbo' ? 'VRBO' : r.platform === 'airbnb' ? 'Airbnb' : 'our site')}${r.date ? `, ${esc(new Date(r.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}` : ''}</p></li>`).join('')}</ul>` : ''}
  </article>
  <aside class="book" id="book" data-book data-id="${esc(h.id)}" data-max="${c.max || 1}" data-pets="${rules.pets_allowed ? '1' : '0'}">
    <div class="book-dates">
      <button type="button" class="date-btn" data-open-cal="start"><span>Check in</span><strong data-label="start">Add date</strong></button>
      <button type="button" class="date-btn" data-open-cal="end"><span>Check out</span><strong data-label="end">Add date</strong></button>
    </div>
    <div class="cal" data-cal hidden></div>
    <div class="book-guests">
      <label>Adults<input type="number" name="adults" min="1" max="${c.max || 1}" value="2" inputmode="numeric"></label>
      <label>Children<input type="number" name="children" min="0" max="${c.max || 1}" value="0" inputmode="numeric"></label>
      ${rules.pets_allowed ? '<label>Pets<input type="number" name="pets" min="0" max="5" value="0" inputmode="numeric"></label>' : ''}
    </div>
    <button type="button" class="btn" data-quote>Check price</button>
    <div class="quote" data-quote-out role="status" aria-live="polite"></div>
    <p class="book-note">Questions first? Call or text <a href="tel:${esc(SITE.phone_e164)}">${esc(SITE.phone)}</a>.</p>
  </aside>
</div>
<a class="mobile-book btn" href="#book">Check dates and price</a>
<dialog class="lightbox" data-lightbox aria-label="Photos">
  <button type="button" class="lb-close" data-lb-close aria-label="Close photos">×</button>
  <button type="button" class="lb-nav lb-prev" data-lb-prev aria-label="Previous photo">‹</button>
  <img data-lb-img alt="Enlarged photo">
  <button type="button" class="lb-nav lb-next" data-lb-next aria-label="Next photo">›</button>
  <p class="lb-count" data-lb-count></p>
</dialog>
<script type="application/json" data-photos>${JSON.stringify(imgs.map((i) => ({ url: i.url, thumb: i.thumbnail_url || i.url, srcset: i.srcset || '', caption: i.caption || '' }))).replace(/</g, '\\u003c')}</script>`;
  return layout({
    title: `${o.title} | ${town(h)} Vacation Rental Near Yellowstone`,
    description: `${o.title} in ${place(h)}. ${facts(h)}. ${perk(h) ? perk(h) + '. ' : ''}Check live availability and book direct.`,
    canonical: `/homes/${o.slug}/`,
    image: imgs[0]?.url,
    body,
    bodyClass: 'page-home',
    jsonld: {
      '@context': 'https://schema.org', '@type': 'VacationRental', name: o.title, url: `${SITE.url}/homes/${o.slug}/`,
      image: imgs.slice(0, 8).map((i) => i.url), description: unshout(h.summary || ''),
      address: { '@type': 'PostalAddress', addressLocality: town(h), addressRegion: stateCode(h), addressCountry: 'US' },
      containsPlace: { '@type': 'Accommodation', occupancy: { '@type': 'QuantitativeValue', maxValue: c.max }, numberOfBedrooms: c.bedrooms, numberOfBathroomsTotal: c.bathrooms },
      amenityFeature: hl.map((a) => ({ '@type': 'LocationFeatureSpecification', name: a, value: true })),
    },
  });
}

const BED = { king_bed: ['king bed', 'king beds'], queen_bed: ['queen bed', 'queen beds'], double_bed: ['full bed', 'full beds'],
  single_bed: ['twin bed', 'twin beds'], bunk_bed: ['bunk bed', 'bunk beds'], sofa_bed: ['sofa bed', 'sofa beds'] };
const ROOM = { bedroom: 'Bedroom', living_room: 'Living room', game_room: 'Game room', childrens_playroom: 'Playroom',
  movie_theater: 'Theater room', workspace: 'Office', dining_room: 'Dining room', garage: 'Garage', deck: 'Deck', patio: 'Patio', porch: 'Porch' };

// Rooms with beds, in Hospitable's order: "Bedroom 1: 1 queen bed", "Living room: 1 sofa bed".
function sleepingRooms(h) {
  const manual = OVERRIDES[h.id]?.rooms;
  if (!(h.room_details || []).some((r) => (r.beds || []).length) && Array.isArray(manual)) return manual;
  let n = 0;
  return (h.room_details || []).filter((r) => (r.beds || []).length).map((r) => {
    const name = r.type === 'bedroom' ? `Bedroom ${++n}` : (ROOM[r.type] || r.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
    const beds = r.beds.map((b) => {
      const [one, many] = BED[b.type] || [b.type.replace(/_/g, ' '), b.type.replace(/_/g, ' ') + 's'];
      return `${b.quantity} ${b.quantity === 1 ? one : many}`;
    });
    return { name, beds: beds.join(', ') };
  });
}

function galleryTiles(imgs, title) {
  if (!imgs.length) return '<div class="g0 placeholder">Photos coming soon</div>';
  const tiles = imgs.slice(0, 5).map((im, i) => `<a class="g${i}" href="${esc(im.url)}" data-photo="${i}"><img src="${esc(i === 0 ? im.url : (im.thumbnail_url || im.url))}"${im.srcset ? ` srcset="${esc(im.srcset)}" sizes="${i === 0 ? '(min-width: 860px) 50vw, 100vw' : '25vw'}"` : ''} alt="${esc(im.caption || `${title} photo ${i + 1}`)}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}></a>`).join('\n  ');
  const more = imgs.length > 1 ? `<button type="button" class="btn-ghost all-photos" data-photo="0">See all ${imgs.length} photos</button>` : '';
  return tiles + more;
}

function photoGrid(imgs, title) {
  return imgs.map((im, i) => `<li><a href="${esc(im.url)}" data-photo="${i}"><img src="${esc(im.thumbnail_url || im.url)}" alt="${esc(im.caption || `${title} photo ${i + 1}`)}" loading="lazy" width="400" height="300"></a></li>`).join('');
}

function fmtTime(t) {
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number);
  const ap = hh >= 12 ? 'pm' : 'am';
  const h12 = ((hh + 11) % 12) + 1;
  return mm ? `${h12}:${String(mm).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}

function notFound() {
  return layout({
    title: `Page not found | ${SITE.name}`, description: 'That page is not here.', canonical: '/404',
    body: `<section class="wrap section"><h1>That page isn't here.</h1><p><a href="/">See all our homes →</a></p></section>`,
  });
}

// ---------- write ----------

const all = await loadHomes();
// Full-resolution photos copied from each home's Airbnb listing (data/airbnb-photos.json, keyed by Hospitable id).
// Hospitable's own copies are small, so these replace them when present. Airbnb's image server resizes with ?im_w=.
const AIRBNB = JSON.parse(await readFile(path.join(ROOT, 'data/airbnb-photos.json'), 'utf8').catch(() => '{}'));
const sized = (u, w) => `${u}?im_w=${w}`;
for (const h of all) {
  const list = AIRBNB[h.id]?.photos;
  if (Array.isArray(list) && list.length) {
    h.images = list.filter((p) => /^https:\/\/a0\.muscache\.com\/im\/pictures\//.test(p.url)).map((p) => ({
      url: sized(p.url, 1920), thumbnail_url: sized(p.url, 720), caption: p.caption || '',
      srcset: [720, 1200, 1920].map((w) => `${sized(p.url, w)} ${w}w`).join(', '),
    }));
  }
}
// A home added in Hospitable later still gets a page, with a title and URL made from its public name.
for (const h of all) {
  if (!OVERRIDES[h.id]) {
    const title = h.public_name || h.name;
    OVERRIDES[h.id] = { title, slug: title.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), hidden: false };
    console.warn(`New home not in data/overrides.json, using "${title}". Add it there to pick its title and URL.`);
  }
}
// "order" in data/overrides.json: low numbers (1, 2, 3...) go first, 1000+ go last, homes without one sit in between in Hospitable's order.
const rank = (h) => OVERRIDES[h.id].order ?? 500;
const homes = all.filter((h) => !OVERRIDES[h.id].hidden)
  .map((h, i) => [h, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([h]) => h);
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'public'), DIST, { recursive: true });

await writeFile(path.join(DIST, 'index.html'), homePage(homes));
await writeFile(path.join(DIST, '404.html'), notFound());
for (const h of homes) {
  const dir = path.join(DIST, 'homes', OVERRIDES[h.id].slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), homeDetail(h));
}
const today = new Date().toISOString().slice(0, 10);
const urls = ['/', ...homes.map((h) => `/homes/${OVERRIDES[h.id].slug}/`)];
await writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE.url}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
await writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE.url}/sitemap.xml\n`);

console.log(`Built ${homes.length} homes into dist/ (${TOKEN ? 'live Hospitable data' : 'sample data'}).`);

// Which commit this build came from (Workers Builds sets WORKERS_CI_COMMIT_SHA), so the live site can be matched to main.
await writeFile(path.join(DIST, 'version.txt'), `${process.env.WORKERS_CI_COMMIT_SHA || 'local'}\n`);
