/**
 * Cloudflare Worker: terminate HTTPS on spoonupfoods.com (Cloudflare cert)
 * and proxy to Cloud Run in Mumbai. www permanently redirects to apex.
 *
 * Cloudflare SSL/TLS mode must be Full (strict) — not Flexible.
 */
const ORIGIN = 'event-order-system-rnrolhtbcq-el.a.run.app';
const CANONICAL_HOST = 'spoonupfoods.com';

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    if (incoming.hostname === `www.${CANONICAL_HOST}`) {
      incoming.hostname = CANONICAL_HOST;
      return Response.redirect(incoming.toString(), 301);
    }

    const originUrl = new URL(request.url);
    originUrl.hostname = ORIGIN;
    originUrl.protocol = 'https:';

    const headers = new Headers(request.headers);
    headers.set('Host', ORIGIN);
    headers.set('X-Forwarded-Host', CANONICAL_HOST);
    headers.set('X-Forwarded-Proto', 'https');

    const init = {
      method: request.method,
      headers,
      redirect: 'manual'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    return fetch(originUrl, init);
  }
};
