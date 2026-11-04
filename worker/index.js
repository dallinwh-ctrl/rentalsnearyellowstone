// Cloudflare Worker entry: /api/* goes to the Hospitable handlers, everything else is the static site in dist/.
import * as search from '../functions/api/search.js';
import * as calendar from '../functions/api/calendar.js';
import * as quote from '../functions/api/quote.js';
import * as photos from '../functions/api/photos.js';

const routes = {
  '/api/search': { GET: search.onRequestGet },
  '/api/calendar': { GET: calendar.onRequestGet },
  '/api/quote': { POST: quote.onRequestPost },
  '/api/photos': { GET: photos.onRequestGet },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Send the bare domain to www so there is one address for search engines.
    if (url.hostname === 'rentalsnearyellowstone.com') {
      url.hostname = 'www.rentalsnearyellowstone.com';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    const route = routes[url.pathname];
    if (route) {
      const handler = route[request.method];
      if (!handler) return new Response('Method not allowed', { status: 405, headers: { allow: Object.keys(route).join(', ') } });
      return handler({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
