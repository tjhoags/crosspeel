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
//   answers conditional requests in RFC 9110 order. A 404 is never cached: a
//   key can be flushed into the bucket after a reader first asked for it. A 412
//   is never cached either.
//
//   Never rendered. A stored body is a third party's response and is served as
//   data, never as a document. Only a fixed set of data types is ever honoured
//   from the object's own metadata; anything else - HTML, XML, SVG, anything a
//   browser would lay out - is served under the key's suffix type instead, and
//   the stored string is never echoed. Every response is nosniff under a
//   sandboxing CSP so nothing served here can run as script on crosspeel.com.
//
//   No listing. The corpus names every key a reader is entitled to. A listing
//   would name the keys the corpus withholds - the evidence behind unpublished
//   groups - and the exporter exists to make sure those never reach a reader.

const EVIDENCE_PREFIX = '/evidence/';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_STORE = 'no-store';

// R2 refuses a key over 1024 bytes with an error rather than a null, and an
// error escaping this route is a Cloudflare 1101 page instead of the route's
// own 404. A permalink key is under 120 bytes.
const MAX_KEY_BYTES = 1024;

// Keys are written by crosspeel-engine/src/lib/store.js as
//   raw/<endpoint uuid>/<ISO 8601 UTC>/<observation uuid>.body
//   raw/<endpoint uuid>/<ISO 8601 UTC>/<observation uuid>.headers.json
// plus reports/, exports/ and sources/ under the same rules: slash-separated
// segments, each starting with a letter or digit, containing only letters,
// digits, dot, hyphen, underscore and colon. Anything else is not a key and
// never reaches the bucket.
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._:-]*';
const KEY_RE = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`);

// The only content types ever honoured from an object's own metadata, mapped to
// the exact value put on the wire. The stored string is used to choose a row
// here and is never itself echoed, which also disposes of comma-joined values,
// stray whitespace and case without special handling.
const SERVABLE = new Map([
  ['application/json', 'application/json'],
  ['application/jsonl', 'application/jsonl; charset=utf-8'],
  ['text/plain', 'text/plain; charset=utf-8'],
  ['application/octet-stream', 'application/octet-stream'],
]);

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
  if (new TextEncoder().encode(key).length > MAX_KEY_BYTES) return null;
  // The regex already refuses a segment that starts with a dot. This is the
  // same rule stated once more in the terms a reader of this file expects.
  if (key.split('/').some((s) => s === '.' || s === '..')) return null;
  return key;
}

/**
 * The content type a stored artifact is served under. A stored type is honoured
 * only when it is one of a fixed set of data types; everything else falls to
 * the key's suffix, because a stored body is served as data and not as a page
 * on this origin.
 *
 * Browsers use the last comma-separated member of a Content-Type value (Fetch,
 * "extract a MIME type"), so that member decides.
 *
 * @param {string} key
 * @param {string | null | undefined} stored the object's httpMetadata.contentType
 */
export function contentTypeFor(key, stored) {
  if (typeof stored === 'string') {
    const members = stored.split(',').map((m) => m.trim()).filter(Boolean);
    const last = members[members.length - 1];
    if (last) {
      const essence = last.split(';')[0].trim().toLowerCase();
      const canonical = SERVABLE.get(essence);
      if (canonical) return canonical;
    }
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
  // Copies contentEncoding, contentDisposition, contentLanguage, cacheControl
  // and cacheExpiry off the object. Cache-Control and Content-Type are then
  // overwritten below: the cache policy is this route's, not the uploader's,
  // and the content type is chosen by contentTypeFor.
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  headers.set('Content-Type', contentTypeFor(key, object.httpMetadata?.contentType));
  headers.set('Cache-Control', IMMUTABLE);
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (typeof object.size === 'number') headers.set('Content-Length', String(object.size));
  if (object.uploaded instanceof Date) headers.set('Last-Modified', object.uploaded.toUTCString());
  headers.set('Accept-Ranges', 'none');
  return securityHeaders(headers);
}

function plain(status, body, extra = {}) {
  const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_STORE, ...extra });
  return new Response(body, { status, headers: securityHeaders(headers) });
}

const notFound = () => plain(404, 'No stored artifact at this key.\n');
const storeError = () => plain(500, 'The artifact store did not answer.\n');
const methodNotAllowed = () => plain(405, 'Evidence is read-only.\n', { Allow: 'GET, HEAD, OPTIONS' });

function etagListIncludes(list, etag) {
  return list.split(',').some((s) => {
    const v = s.trim();
    return v === '*' || v === etag;
  });
}

/**
 * True when If-Match or If-Unmodified-Since, evaluated in RFC 9110 s13.2.2
 * order, refused the request. R2 returns a body-less object for any failed
 * precondition; which family failed decides between 412 and 304.
 */
function preconditionFailed(request, object) {
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch !== null) return !etagListIncludes(ifMatch, object.httpEtag);
  const ifUnmodified = request.headers.get('If-Unmodified-Since');
  if (ifUnmodified !== null) {
    const t = Date.parse(ifUnmodified);
    return !Number.isNaN(t) && object.uploaded instanceof Date && object.uploaded.getTime() > t;
  }
  return false;
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
    let head;
    try {
      head = await env.ARTIFACTS.head(key);
    } catch {
      return storeError();
    }
    if (head === null) return notFound();
    return new Response(null, { status: 200, headers: objectHeaders(key, head) });
  }

  // R2 evaluates all four conditional headers when handed the request headers
  // and returns the object without a body when any one fails.
  let object;
  try {
    object = await env.ARTIFACTS.get(key, { onlyIf: request.headers });
  } catch {
    return storeError();
  }
  if (object === null) return notFound();
  const headers = objectHeaders(key, object);
  if (object.body === null || object.body === undefined) {
    headers.delete('Content-Length');
    if (preconditionFailed(request, object)) {
      headers.set('Cache-Control', NO_STORE);
      return new Response(null, { status: 412, headers });
    }
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
