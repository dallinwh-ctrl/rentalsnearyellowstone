// POST /api/quote  {id, checkin, checkout, adults, children, infants, pets, promo}
// Asks Hospitable for a direct-booking quote. The response carries the full price
// breakdown and a booking_url where the guest pays on Hospitable's secure checkout.
import { hospitable, isUuid, isDate, count, json, fail, ApiError } from '../../lib/hospitable.js';

export async function onRequestPost({ request, env }) {
  let input;
  try { input = await request.json(); } catch { return fail('Bad request.'); }
  const { id, checkin, checkout } = input || {};
  if (!isUuid(id)) return fail('Unknown home.');
  if (!isDate(checkin) || !isDate(checkout) || checkout <= checkin) return fail('Pick a check-in and a later check-out date.');

  const guests = { adults: count(input.adults, 1, 30) };
  for (const k of ['children', 'infants', 'pets']) {
    const n = count(input[k], 0, k === 'pets' ? 10 : 30);
    if (n) guests[k] = n;
  }
  const body = { checkin_date: checkin, checkout_date: checkout, guests };
  if (typeof input.promo === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(input.promo)) body.promo_code = input.promo;

  try {
    const res = await hospitable(env, `/properties/${id}/quote`, { method: 'POST', body: JSON.stringify(body) });
    const d = res?.data || {};
    if (!d.booking_url || !/^https:\/\/booking\.hospitable\.com\//.test(d.booking_url)) {
      return fail('These dates could not be priced. Try different dates or text us.', 422);
    }
    const f = d.financials || {};
    const lines = [
      { label: 'Stay', amount: f.totals?.sub_total?.formatted },
      ...(f.fees || []).map((x) => ({ label: x.label, amount: x.formatted })),
      ...(f.discounts || []).map((x) => ({ label: x.label, amount: x.formatted })),
      ...(f.taxes || []).map((x) => ({ label: x.label, amount: x.formatted })),
    ].filter((l) => l.amount);
    return json({
      booking_url: d.booking_url,
      currency: d.currency,
      lines,
      total: f.totals?.total?.formatted || null,
    }, 200, { 'cache-control': 'no-store' });
  } catch (e) {
    return fail(e instanceof ApiError ? e.message : 'Could not get a price. Please try again.', e.status || 502);
  }
}
