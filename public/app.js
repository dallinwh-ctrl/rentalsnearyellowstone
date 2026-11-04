(() => {
  'use strict';

  // ---------- date helpers (all dates are YYYY-MM-DD strings, handled in UTC) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parse = (s) => new Date(s + 'T00:00:00Z');
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
  const nightsBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
  const pretty = (s) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const params = new URLSearchParams(location.search);

  function stayFromUrl() {
    const start = params.get('start');
    const end = params.get('end');
    const ok = isDate(start) && isDate(end) && end > start && start >= todayLocal();
    return {
      start: ok ? start : '',
      end: ok ? end : '',
      adults: Math.max(1, parseInt(params.get('adults') || '2', 10) || 2),
      children: Math.max(0, parseInt(params.get('children') || '0', 10) || 0),
    };
  }

  function stayQuery(s) {
    const q = new URLSearchParams();
    if (s.start && s.end) { q.set('start', s.start); q.set('end', s.end); }
    q.set('adults', String(s.adults));
    if (s.children) q.set('children', String(s.children));
    return q.toString();
  }

  // ---------- home page: search + town filter ----------
  const grid = document.querySelector('[data-grid]');
  if (grid) initListing();

  function initListing() {
    const form = document.querySelector('[data-search]');
    const status = document.querySelector('[data-search-status]');
    const countEl = document.querySelector('[data-count]');
    const empty = document.querySelector('[data-empty]');
    const cards = [...grid.querySelectorAll('.card')];
    const chips = [...document.querySelectorAll('.chip')];
    let town = '';
    let results = null; // id -> {available, price}
    let guests = 0;

    const stay = stayFromUrl();
    form.start.min = todayLocal();
    form.end.min = todayLocal();
    if (stay.start) { form.start.value = stay.start; form.end.value = stay.end; }
    form.adults.value = stay.adults;
    form.children.value = stay.children;

    form.start.addEventListener('change', () => {
      if (form.start.value) {
        form.end.min = addDays(form.start.value, 1);
        if (!form.end.value || form.end.value <= form.start.value) form.end.value = addDays(form.start.value, 3);
      }
    });

    chips.forEach((chip) => chip.addEventListener('click', () => {
      town = chip.dataset.town;
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      render();
    }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const s = {
        start: form.start.value, end: form.end.value,
        adults: Math.max(1, parseInt(form.adults.value, 10) || 1),
        children: Math.max(0, parseInt(form.children.value, 10) || 0),
      };
      if (!isDate(s.start) || !isDate(s.end) || s.end <= s.start) {
        status.textContent = 'Pick a check-in date and a later check-out date.';
        return;
      }
      history.replaceState(null, '', `?${stayQuery(s)}#homes`);
      await search(s);
    });

    async function search(s) {
      const btn = form.querySelector('button');
      btn.disabled = true;
      status.textContent = 'Checking every calendar…';
      guests = s.adults + s.children;
      try {
        const res = await fetch(`/api/search?${new URLSearchParams({ start: s.start, end: s.end, adults: s.adults, children: s.children })}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Search failed');
        results = {};
        for (const h of data.homes) results[h.id] = h;
        const nights = nightsBetween(s.start, s.end);
        status.textContent = `Showing homes open ${pretty(s.start)} to ${pretty(s.end)} (${nights} night${nights === 1 ? '' : 's'}).`;
        cards.forEach((card) => {
          const r = results[card.dataset.id];
          const price = card.querySelector('.card-price');
          if (r && r.available && r.total_without_taxes) {
            const whole = r.total_without_taxes_amount > 0
              ? '$' + Math.round(r.total_without_taxes_amount).toLocaleString('en-US')
              : r.total_without_taxes;
            price.textContent = `${whole} for ${nights} night${nights === 1 ? '' : 's'}, before taxes`;
            price.hidden = false;
          } else {
            price.hidden = true;
          }
        });
        // carry the dates onto each home's page
        const q = stayQuery(s);
        cards.forEach((card) => {
          const a = card.querySelector('a');
          a.href = a.href.split('?')[0] + '?' + q;
        });
        render();
        document.getElementById('homes').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        results = null;
        status.textContent = `${err.message}. You can still open any home, or call or text us.`;
        render();
      } finally {
        btn.disabled = false;
      }
    }

    function render() {
      let shown = 0;
      cards.forEach((card) => {
        const okTown = !town || card.dataset.town === town;
        const okGuests = !guests || Number(card.dataset.guests) >= guests;
        const r = results && results[card.dataset.id];
        const okDates = !results || (r && r.available);
        const show = okTown && okGuests && okDates;
        card.hidden = !show;
        if (show) shown++;
      });
      countEl.textContent = results
        ? `${shown} home${shown === 1 ? '' : 's'} open for your dates`
        : (town ? `Our homes in ${town}` : 'Our homes near Yellowstone');
      empty.hidden = shown > 0;
    }

    if (stay.start) search(stay);
  }

  // ---------- single home page: calendar, quote, photos ----------
  const book = document.querySelector('[data-book]');
  if (book) initBooking(book);
  initLightbox();

  function initBooking(box) {
    const id = box.dataset.id;
    const max = Number(box.dataset.max) || 1;
    const calEl = box.querySelector('[data-cal]');
    const out = box.querySelector('[data-quote-out]');
    const quoteBtn = box.querySelector('[data-quote]');
    const openBtns = [...box.querySelectorAll('[data-open-cal]')];
    const label = { start: box.querySelector('[data-label="start"]'), end: box.querySelector('[data-label="end"]') };
    const input = (n) => box.querySelector(`input[name="${n}"]`);

    const stay = stayFromUrl();
    let start = stay.start;
    let end = stay.end;
    input('adults').value = Math.min(stay.adults, max);
    input('children').value = stay.children;

    const days = new Map(); // date -> day info
    const loaded = new Map();
    const today = todayLocal();
    const first = parse(today); first.setUTCDate(1);
    let view = start ? parse(start) : new Date(first);
    view.setUTCDate(1);
    const lastMonth = new Date(first); lastMonth.setUTCMonth(lastMonth.getUTCMonth() + 18);

    showLabels();

    openBtns.forEach((b) => {
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', () => {
        const open = calEl.hidden || b.getAttribute('aria-expanded') !== 'true';
        openBtns.forEach((x) => x.setAttribute('aria-expanded', 'false'));
        if (open) {
          b.setAttribute('aria-expanded', 'true');
          calEl.hidden = false;
          if (b.dataset.openCal === 'start') { start = ''; end = ''; showLabels(); }
          draw();
        } else {
          calEl.hidden = true;
        }
      });
    });

    // month key "YYYY-MM" -> promise of that month's data, so repeated clicks share one request
    function loadMonths(from) {
      const key = ymd(from).slice(0, 7);
      if (loaded.has(key)) return loaded.get(key);
      const s = ymd(from);
      const e = new Date(from); e.setUTCMonth(e.getUTCMonth() + 2); e.setUTCDate(e.getUTCDate() + 7);
      const next = new Date(from); next.setUTCMonth(next.getUTCMonth() + 1);
      const p = (async () => {
        try {
          const res = await fetch(`/api/calendar?${new URLSearchParams({ id, start: s < today ? today : s, end: ymd(e) })}`);
          const data = await res.json();
          if (res.ok) for (const d of data.days) days.set(d.date, d);
        } catch { /* calendar is a helper; the quote is still the final check */ }
      })();
      loaded.set(key, p);
      loaded.set(ymd(next).slice(0, 7), p);
      return p;
    }

    function nightOk(date) {
      const d = days.get(date);
      return !d || d.available;
    }

    function canStart(date) {
      if (date < today) return false;
      const d = days.get(date);
      return !d || (d.available && !d.no_checkin);
    }

    function canEnd(date) {
      if (!start || date <= start) return false;
      const d = days.get(date);
      if (d && d.no_checkout) return false;
      for (let x = start; x < date; x = addDays(x, 1)) if (!nightOk(x)) return false;
      const s = days.get(start);
      return nightsBetween(start, date) >= ((s && s.min_stay) || 1);
    }

    let drawing = 0;
    async function draw() {
      const ticket = ++drawing;
      if (!loaded.has(ymd(view).slice(0, 7))) calEl.innerHTML = '<p>Loading calendar…</p>';
      await loadMonths(new Date(view));
      if (ticket !== drawing) return; // a newer click already redrew
      const choosingEnd = Boolean(start && !end);
      const y = view.getUTCFullYear();
      const m = view.getUTCMonth();
      const monthName = view.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
      const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const prevOk = view > first;
      const nextOk = view < lastMonth;
      let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span class="cal-dow" aria-hidden="true">${d}</span>`).join('');
      for (let i = 0; i < lead; i++) cells += '<span></span>';
      for (let i = 1; i <= count; i++) {
        const date = `${y}-${pad(m + 1)}-${pad(i)}`;
        const ok = choosingEnd ? canEnd(date) : canStart(date);
        const cls = ['cal-day'];
        if (date === start || date === end) cls.push('sel');
        else if (start && end && date > start && date < end) cls.push('in-range');
        const info = days.get(date);
        const title = info && info.price && ok && !choosingEnd ? ` title="${info.price} a night"` : '';
        cells += `<button type="button" class="${cls.join(' ')}" data-date="${date}" ${ok ? '' : 'disabled'} aria-label="${pretty(date)}${ok ? '' : ', unavailable'}"${title}>${i}</button>`;
      }
      const s = start && days.get(start);
      const hint = choosingEnd
        ? `Pick your check-out date${s && s.min_stay > 1 ? ` (${s.min_stay} night minimum from this date)` : ''}.`
        : 'Pick your check-in date.';
      calEl.innerHTML = `
        <div class="cal-head">
          <button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month" ${prevOk ? '' : 'disabled'}>‹</button>
          <strong>${monthName}</strong>
          <button type="button" class="cal-nav" data-nav="1" aria-label="Next month" ${nextOk ? '' : 'disabled'}>›</button>
        </div>
        <div class="cal-grid">${cells}</div>
        <div class="cal-foot"><span>${hint}</span>${start ? '<button type="button" data-clear>Clear</button>' : ''}</div>`;
    }

    calEl.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) {
        view.setUTCMonth(view.getUTCMonth() + Number(nav.dataset.nav));
        draw();
        return;
      }
      if (e.target.closest('[data-clear]')) {
        start = ''; end = ''; showLabels(); setOpen('start'); draw();
        return;
      }
      const day = e.target.closest('[data-date]');
      if (!day || day.disabled) return;
      const date = day.dataset.date;
      if (!start || end) {
        start = date; end = '';
        setOpen('end');
      } else {
        end = date;
        calEl.hidden = true;
        openBtns.forEach((x) => x.setAttribute('aria-expanded', 'false'));
        getQuote();
      }
      showLabels();
      if (!calEl.hidden) draw();
    });

    function setOpen(which) {
      openBtns.forEach((x) => x.setAttribute('aria-expanded', String(x.dataset.openCal === which)));
    }

    function showLabels() {
      label.start.textContent = start ? pretty(start) : 'Add date';
      label.end.textContent = end ? pretty(end) : 'Add date';
      out.innerHTML = '';
    }

    quoteBtn.addEventListener('click', () => {
      if (!start || !end) {
        calEl.hidden = false;
        setOpen(start ? 'end' : 'start');
        draw();
        return;
      }
      getQuote();
    });

    async function getQuote() {
      const adults = Math.max(1, parseInt(input('adults').value, 10) || 1);
      const children = Math.max(0, parseInt(input('children').value, 10) || 0);
      const pets = input('pets') ? Math.max(0, parseInt(input('pets').value, 10) || 0) : 0;
      if (adults + children > max) {
        out.innerHTML = `<p class="err">This home sleeps ${max}. Try fewer guests or another home.</p>`;
        return;
      }
      quoteBtn.disabled = true;
      out.innerHTML = '<p>Getting your price…</p>';
      try {
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, checkin: start, checkout: end, adults, children, pets }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not get a price');
        const nights = nightsBetween(start, end);
        const rows = data.lines.map((l) => `<div class="row"><span>${esc(l.label === 'Stay' ? `${nights} night${nights === 1 ? '' : 's'}` : l.label)}</span><span>${esc(l.amount)}</span></div>`).join('');
        out.innerHTML = `${rows}
          <div class="row total"><span>Total</span><span>${esc(data.total)}</span></div>
          <a class="btn" href="${esc(data.booking_url)}">Book now</a>
          <small>You'll pay on our secure checkout. Nothing is charged until you confirm there.</small>`;
        history.replaceState(null, '', `?${stayQuery({ start, end, adults, children })}`);
      } catch (err) {
        out.innerHTML = `<p class="err">${esc(err.message)}</p>`;
      } finally {
        quoteBtn.disabled = false;
      }
    }

    if (start && end) getQuote();

    // hide the phone "Check dates" bar while the booking box is on screen
    const bar = document.querySelector('.mobile-book');
    if (bar && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { bar.style.visibility = e.isIntersecting ? 'hidden' : 'visible'; }).observe(box);
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Photos: rendered at build time when the build has the Hospitable key; otherwise fetched live here.
  async function initLightbox() {
    const dlg = document.querySelector('[data-lightbox]');
    const data = document.querySelector('[data-photos]');
    const box = document.querySelector('[data-book]');
    if (!dlg || !data) return;
    let photos = JSON.parse(data.textContent || '[]');
    const title = (document.querySelector('.detail-main h1') || {}).textContent || 'Home';
    if (photos.length <= 1 && box) {
      try {
        const res = await fetch(`/api/photos?id=${encodeURIComponent(box.dataset.id)}`);
        const body = await res.json();
        if (res.ok && body.photos && body.photos.length > photos.length) {
          photos = body.photos;
          renderPhotos(photos, title);
        }
      } catch { /* keep what the page already has */ }
    }
    if (!photos.length || typeof dlg.showModal !== 'function') return;
    const img = dlg.querySelector('[data-lb-img]');
    const countEl = dlg.querySelector('[data-lb-count]');
    let i = 0;
    const show = () => { img.src = photos[i].url; img.alt = photos[i].caption || `Photo ${i + 1} of ${photos.length}`; countEl.textContent = `${i + 1} / ${photos.length}`; };
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-photo]');
      if (!el) return;
      e.preventDefault();
      i = Number(el.dataset.photo) || 0;
      show();
      dlg.showModal();
    });
    dlg.querySelector('[data-lb-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-lb-prev]').addEventListener('click', () => { i = (i - 1 + photos.length) % photos.length; show(); });
    dlg.querySelector('[data-lb-next]').addEventListener('click', () => { i = (i + 1) % photos.length; show(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { i = (i - 1 + photos.length) % photos.length; show(); }
      if (e.key === 'ArrowRight') { i = (i + 1) % photos.length; show(); }
    });
  }

  function renderPhotos(photos, title) {
    const alt = (p, i) => esc(p.caption || `${title} photo ${i + 1}`);
    const gallery = document.querySelector('[data-gallery]');
    if (gallery) {
      gallery.innerHTML = photos.slice(0, 5).map((p, i) =>
        `<a class="g${i}" href="${esc(p.url)}" data-photo="${i}"><img src="${esc(i === 0 ? p.url : p.thumb)}" alt="${alt(p, i)}"></a>`).join('')
        + `<button type="button" class="btn-ghost all-photos" data-photo="0">See all ${photos.length} photos</button>`;
    }
    const grid = document.querySelector('[data-photo-grid]');
    const section = document.querySelector('[data-photo-section]');
    if (grid && section) {
      grid.innerHTML = photos.map((p, i) =>
        `<li><a href="${esc(p.url)}" data-photo="${i}"><img src="${esc(p.thumb)}" alt="${alt(p, i)}" loading="lazy" width="400" height="300"></a></li>`).join('');
      section.hidden = false;
    }
  }
})();
