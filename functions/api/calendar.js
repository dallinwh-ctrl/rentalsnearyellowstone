// GET /api/calendar?id=<property uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns day-by-day availability so the date picker can grey out booked nights.
import { hospitable, isUuid, isDate, json, fail, cached, ApiError } from '../../lib/hospitable.js';

const MAX_DAYS = 120;

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = new URL(request.url).searchParams;
  const id = q.get('id');
  const start = q.get('start');
  const end = q.get('end');
  if (!isUuid(id)) return fail('Unknown home.');
  if (!isDate(start) || !isDate(end) || end < start) return fail('Bad date range.');
  const span = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (span > MAX_DAYS) return fail(`Ask for at most ${MAX_DAYS} days at a time.`);

  return cached(request, context, 300, async () => {
    try {
      const body = await hospitable(env, `/properties/${id}/calendar?start_date=${start}&end_date=${end}`);
      const days = (body?.data?.days || []).map((d) => ({
        date: d.date,
        available: Boolean(d.status?.available),
        min_stay: d.min_stay ?? 1,
        no_checkin: Boolean(d.closed_for_checkin),
        no_checkout: Boolean(d.closed_for_checkout),
        price: d.price?.formatted || null,
      }));
      return json({ id, days });
    } catch (e) {
      return fail(e instanceof ApiError ? e.message : 'Could not load the calendar.', e.status || 502);
    }
  });
}
