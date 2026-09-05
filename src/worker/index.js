// The evidence route.
//
// Every evidence permalink the exporter writes is
// https://crosspeel.com/evidence/<r2 key>, and until 2026-09-05 nothing served
// that path: the site was static assets only, so a reader who clicked the
// artifact link under a stored response got a 404. Document 02 says the
// permalink on an evidence row must resolve, and src/data/README.md says a
// cluster page whose evidence link 404s is worse than no cluster page. This is
// the piece that was missing.
//
// It does one thing. GET or HEAD under /evidence/ reads the key from the
// write-once artifact bucket and returns it. assets.run_worker_first in
// wrangler.json is scoped to /evidence/*, so for every other path the Worker
// is not invoked at all and the static site is served as before. The fallthrough
// to env.ASSETS at the bottom is defensive, not a route.
//
// Three rules, each chosen for what the evidence is.
//
//   Immutable. Objects are write-once - document 02, Services - so the response
//   carries the object's own strong ETag, a year-long immutable cache, and
//   answers conditional requests. A 404 is never cached: a key can be flushed
//   into the bucket after a reader first asked for it.
//
//   Never rendered. A stored body is a third party's response and is served as
//   data, never as a document. HTML content types are downgraded to text/plain,
//   every response is nosniff, and a sandboxing CSP is set so nothing served
//   here can run as script on crosspeel.com.
//
//   No listing. The corpus names every key a reader is entitled to. A listing
//   would name the keys the corpus withholds - the evidence behind unpublished
//   groups - and the exporter exists to make sure those never reach a reader.

const EVIDENCE_PREFIX = '/evidence/';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_STORE = 'no-store';

// Keys are written by crosspeel-engine/src/lib/store.js as
//   raw/<endpoint uuid>/<ISO 8601 UTC>/<observation uuid>.body
//   raw/<endpoint uuid>/<ISO 8601 UTC>/<observation uuid>.headers.json
// plus reports/, exports/ and sources/ under the same rules: slash-separated
// segments, each starting with a letter or digit, containing only letters,
// digits, dot, hyphen, underscore and colon. Anything else is not a key and
// never reaches the bucket.
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._:-]*';
const KEY_RE = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`);

const CONTENT_TYPE_BY_SUFFIX = [
  ['.headers.json', 'application/json; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.jsonl', 'application/jsonl; charset=utf-8'],
  ['.html', 'text/plain; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.body', 'application/octet-stream'],
];

/**
 * The R2 key named by a request path, or null when the path is not a key.
 * @param {string} pathname
 * @returns {string | null}
 */
export function keyFromPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(EVIDENCE_PREFIX)) return null;
  let key;
  try {
    key = decodeURIComponent(pathname.slice(EVIDENCE_PREFIX.length));
  } catch {
    return null;
  }
  if (!key || !KEY_RE.test(key)) return null;
  // The regex already refuses a segment that starts with a dot. This is the
  // same rule stated once more in the terms a reader of this file expects.
  if (key.split('/').some((s) => s === '.' || s === '..')) return null;
  return key;
}

/**
 * The content type a stored artifact is served under. The stored type wins
 * where it is safe to honour; HTML is never honoured, because a stored body is
 * served as data and not as a page on this origin.
 * @param {string} key
 * @param {string | null | undefined} stored the object's httpMetadata.contentType
 */
export function contentTypeFor(key, stored) {
  if (typeof stored === 'string' && stored.trim()) {
    const lower = stored.toLowerCase();
    if (lower.startsWith('text/html') || lower.startsWith('application/xhtml')) {
      return 'text/plain; charset=utf-8';
    }
    return stored;
  }
  for (const [suffix, type] of CONTENT_TYPE_BY_SUFFIX) {
    if (key.endsWith(suffix)) return type;
  }
  return 'application/octet-stream';
}

function securityHeaders(headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return headers;
}

function objectHeaders(key, object) {
  const headers = new Headers();
  // Copies contentType, contentEncoding, contentDisposition, contentLanguage,
  // cacheControl and cacheExpiry off the object. Cache-Control and Content-Type
  // are then overwritten below: the cache policy is this route's, not the
  // uploader's, and the content type is filtered.
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  headers.set('Content-Type', contentTypeFor(key, object.httpMetadata?.contentType));
  headers.set('Cache-Control', IMMUTABLE);
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (typeof object.size === 'number') headers.set('Content-Length', String(object.size));
  if (object.uploaded instanceof Date) headers.set('Last-Modified', object.uploaded.toUTCString());
  headers.set('Accept-Ranges', 'none');
  return securityHeaders(headers);
}

function notFound() {
  return new Response('No stored artifact at this key.\n', {
    status: 404,
    headers: securityHeaders(
      new Headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_STORE }),
    ),
  });
}

function methodNotAllowed() {
  return new Response('Evidence is read-only.\n', {
    status: 405,
    headers: securityHeaders(
      new Headers({
        Allow: 'GET, HEAD, OPTIONS',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': NO_STORE,
      }),
    ),
  });
}

/**
 * Serve one evidence request from the artifact bucket.
 * @param {Request} request
 * @param {{ ARTIFACTS: R2Bucket }} env
 */
export async function handleEvidence(request, env) {
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: securityHeaders(new Headers({ Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': NO_STORE })),
    });
  }
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed();

  const key = keyFromPath(new URL(request.url).pathname);
  if (key === null) return notFound();

  if (method === 'HEAD') {
    const head = await env.ARTIFACTS.head(key);
    if (head === null) return notFound();
    return new Response(null, { status: 200, headers: objectHeaders(key, head) });
  }

  // R2 evaluates If-None-Match and If-Modified-Since itself when handed the
  // request headers. A precondition that holds comes back as an object with no
  // body, which is a 304 with the object's own headers.
  const object = await env.ARTIFACTS.get(key, { onlyIf: request.headers });
  if (object === null) return notFound();
  const headers = objectHeaders(key, object);
  if (object.body === null || object.body === undefined) {
    headers.delete('Content-Length');
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

export default {
  /**
   * @param {Request} request
   * @param {{ ARTIFACTS: R2Bucket, ASSETS: { fetch: (r: Request) => Promise<Response> } }} env
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/evidence' || pathname.startsWith(EVIDENCE_PREFIX)) {
      return handleEvidence(request, env);
    }
    // Not reachable under the shipped wrangler.json, where run_worker_first is
    // scoped to /evidence/*. Present so that a wider scope, set later, does not
    // turn the whole site into a 404.
    return env.ASSETS.fetch(request);
  },
};
