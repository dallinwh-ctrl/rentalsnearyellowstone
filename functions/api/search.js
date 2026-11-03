// GET /api/search?start=YYYY-MM-DD&end=YYYY-MM-DD&adults=2&children=0&pets=0
// Returns availability and pre-tax price for every home for those dates.
import { hospitable, isDate, count, json, fail, cached, ApiError } from '../../lib/hospitable.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = new URL(request.url).searchParams;
  const start = q.get('start');
  const end = q.get('end');
  if (!isDate(start) || !isDate(end) || end <= start) return fail('Pick a check-in and a later check-out date.');

  return cached(request, context, 300, async () => {
    const params = new URLSearchParams({
      start_date: start,
      end_date: end,
      adults: String(count(q.get('adults'), 1, 30)),
    });
    const children = count(q.get('children'), 0, 30);
    const pets = count(q.get('pets'), 0, 10);
    if (children) params.set('children', String(children));
    if (pets) params.set('pets', String(pets));
    try {
      const body = await hospitable(env, `/properties/search?${params}`);
      const homes = (body?.data || []).map((r) => ({
        id: r.property?.id,
        available: Boolean(r.availability?.available),
        total_without_taxes: r.pricing?.total_without_taxes?.formatted_string || null,
        total_without_taxes_amount: Number(r.pricing?.total_without_taxes?.amount ?? 0) / 100,
      })).filter((h) => h.id);
      return json({ start, end, homes });
    } catch (e) {
      return fail(e instanceof ApiError ? e.message : 'Search failed. Please try again.', e.status || 502);
    }
  });
}
