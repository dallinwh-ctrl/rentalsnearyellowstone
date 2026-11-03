// Small helper for calling the Hospitable Public API from Cloudflare Pages Functions.
// The API token lives in the HOSPITABLE_TOKEN environment variable (set in Cloudflare),
// never in this repository.

const API = 'https://public.api.hospitable.com/v2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(v) {
  return typeof v === 'string' && UUID.test(v);
}

export function isDate(v) {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function count(v, min, max) {
  const n = Number.parseInt(v ?? '', 10);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function fail(message, status = 400) {
  return json({ error: message }, status, { 'cache-control': 'no-store' });
}

export async function hospitable(env, path, init = {}) {
  if (!env.HOSPITABLE_TOKEN) {
    throw new ApiError('Booking is not connected yet.', 503);
  }
  const res = await fetch(API + path, {
    ...init,
    headers: {
      authorization: `Bearer ${env.HOSPITABLE_TOKEN}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    // Hospitable explains a refused quote (dates taken, min stay, too many guests) in `message`.
    const msg = body?.message || body?.error || `Booking system error (${res.status})`;
    throw new ApiError(msg, res.status >= 500 ? 502 : 422);
  }
  return body;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Cache GET responses at the edge for a few minutes so busy pages don't hammer the API.
export async function cached(request, ctx, seconds, produce) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await produce();
  if (res.status === 200) {
    const copy = new Response(res.body, res);
    copy.headers.set('cache-control', `public, max-age=${seconds}`);
    ctx.waitUntil(cache.put(key, copy.clone()));
    return copy;
  }
  return res;
}
