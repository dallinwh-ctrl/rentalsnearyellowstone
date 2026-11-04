// GET /api/photos?id=<property uuid>
// The home's full photo set from Hospitable, in order. Cached at the edge for 6 hours.
import { hospitable, isUuid, json, fail, cached, ApiError } from '../../lib/hospitable.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get('id');
  if (!isUuid(id)) return fail('Unknown home.');
  return cached(request, context, 21600, async () => {
    try {
      const body = await hospitable(env, `/properties/${id}/images`);
      const photos = (body?.data || [])
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .filter((p) => /^https:\/\//.test(p.url || ''))
        .map((p) => ({ url: p.url, thumb: p.thumbnail_url || p.url, caption: p.caption || '' }));
      return json({ id, photos });
    } catch (e) {
      return fail(e instanceof ApiError ? e.message : 'Could not load photos.', e.status || 502);
    }
  });
}
