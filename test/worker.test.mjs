// The evidence route, src/worker/index.js.
//
// Written against a fake bucket and a fake assets binding so every branch of
// the route is exercised without a deploy: what is served, what is refused,
// what is never asked of the bucket at all. The route is the one piece of this
// repository that runs code at request time, and the rules it enforces -
// immutable, never rendered, no listing - are asserted here rather than
// described in a comment and hoped for.

import { describe, it, expect } from 'vitest';
import worker, { handleEvidence, keyFromPath, contentTypeFor } from '../src/worker/index.js';

const BODY_KEY = 'raw/01a06c2a-16cd-7dfa-9d79-4e6edf6bef9f/2026-09-04T11:42:01Z/01a06c39-c79c-7ff4-983d-97170743f649.body';
const HEADERS_KEY = 'raw/01a06c2a-16cd-7dfa-9d79-4e6edf6bef9f/2026-09-04T11:42:01Z/01a06c39-c79c-7ff4-983d-97170743f649.headers.json';

function fakeObject(key, bytes, { contentType, uploaded } = {}) {
  const etag = `"${key.length}-${bytes.length}"`;
  return {
    key,
    size: bytes.length,
    httpEtag: etag,
    etag: etag.replace(/"/g, ''),
    uploaded: uploaded ?? new Date('2026-09-04T12:00:00Z'),
    httpMetadata: contentType ? { contentType } : {},
    writeHttpMetadata(headers) {
      if (contentType) headers.set('Content-Type', contentType);
    },
  };
}

/** A bucket that records every call, so a test can assert it was not consulted. */
function fakeBucket(objects) {
  const calls = [];
  return {
    calls,
    async head(key) {
      calls.push(['head', key]);
      const o = objects.get(key);
      return o ? fakeObject(key, o.bytes, o) : null;
    },
    async get(key, opts = {}) {
      calls.push(['get', key, opts]);
      const o = objects.get(key);
      if (!o) return null;
      const obj = fakeObject(key, o.bytes, o);
      const ifNoneMatch = opts.onlyIf && typeof opts.onlyIf.get === 'function' ? opts.onlyIf.get('If-None-Match') : null;
      if (ifNoneMatch && ifNoneMatch === obj.httpEtag) return { ...obj, body: null };
      return { ...obj, body: o.bytes };
    },
  };
}

function envWith(objects) {
  return {
    ARTIFACTS: fakeBucket(objects),
    ASSETS: {
      calls: [],
      async fetch(request) {
        this.calls.push(new URL(request.url).pathname);
        return new Response('asset', { status: 200, headers: { 'X-From': 'assets' } });
      },
    },
  };
}

const enc = (s) => new TextEncoder().encode(s);

function objects() {
  return new Map([
    [BODY_KEY, { bytes: enc('{"ok":true}'), contentType: 'application/json' }],
    [HEADERS_KEY, { bytes: enc('{"server":"cloudflare"}') }],
    ['raw/e/2026-09-04T11:42:01Z/o.body', { bytes: enc('<script>alert(1)</script>'), contentType: 'text/html; charset=utf-8' }],
    ['raw/e/2026-09-04T11:42:01Z/p.body', { bytes: enc('plain') }],
  ]);
}

const req = (path, init = {}) => new Request(`https://crosspeel.com${path}`, init);

describe('keyFromPath - what is and is not a key', () => {
  it('maps the permalink path the exporter writes to the key the engine wrote', () => {
    expect(keyFromPath(`/evidence/${BODY_KEY}`)).toBe(BODY_KEY);
    expect(keyFromPath(`/evidence/${HEADERS_KEY}`)).toBe(HEADERS_KEY);
  });

  it('decodes a percent-encoded colon in the timestamp segment', () => {
    const encoded = `/evidence/${BODY_KEY.replace(/:/g, '%3A')}`;
    expect(keyFromPath(encoded)).toBe(BODY_KEY);
  });

  it('refuses everything that is not a key', () => {
    for (const bad of [
      '/evidence/',
      '/evidence',
      '/evidence//raw/x',
      '/evidence/raw/../x',
      '/evidence/raw/./x',
      '/evidence/.hidden',
      '/evidence/raw/x/',
      '/evidence/raw/x?y=1',
      '/evidence/raw/%2e%2e/x',
      '/evidence/raw/x y',
      '/evidence/%',
      '/clusters/',
      '/evidence-extra/raw/x',
    ]) {
      expect(keyFromPath(bad), bad).toBeNull();
    }
  });
});

describe('contentTypeFor - served as data, never as a page', () => {
  it('honours a stored content type that is safe to honour', () => {
    expect(contentTypeFor(BODY_KEY, 'application/json')).toBe('application/json');
  });

  it('downgrades HTML to text/plain whatever the object claims', () => {
    expect(contentTypeFor(BODY_KEY, 'text/html')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor(BODY_KEY, 'text/html; charset=utf-8')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor(BODY_KEY, 'application/xhtml+xml')).toBe('text/plain; charset=utf-8');
  });

  it('derives a type from the key when the object carries none', () => {
    expect(contentTypeFor(HEADERS_KEY, null)).toBe('application/json; charset=utf-8');
    expect(contentTypeFor(BODY_KEY, undefined)).toBe('application/octet-stream');
    expect(contentTypeFor('reports/x.html', '')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('sources/x/raw', null)).toBe('application/octet-stream');
  });
});

describe('GET /evidence/<key>', () => {
  it('serves a stored artifact with its own etag, an immutable cache, and no sniffing', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req(`/evidence/${BODY_KEY}`), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('ETag')).toMatch(/^".+"$/);
    expect(res.headers.get('Content-Length')).toBe('11');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('Accept-Ranges')).toBe('none');
    expect(res.headers.get('Last-Modified')).toBe('Fri, 04 Sep 2026 12:00:00 GMT');
  });

  it('serves headers json as json when the object carries no content type', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req(`/evidence/${HEADERS_KEY}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('never serves a stored body as HTML on this origin', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req('/evidence/raw/e/2026-09-04T11:42:01Z/o.body'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('<script>alert(1)</script>');
  });

  it('returns 404, uncached, for a key that is not in the bucket', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req('/evidence/raw/e/2026-09-04T11:42:01Z/missing.body'), env);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toContain('No stored artifact');
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const env = envWith(objects());
    const first = await handleEvidence(req(`/evidence/${BODY_KEY}`), env);
    const etag = first.headers.get('ETag');
    const second = await handleEvidence(req(`/evidence/${BODY_KEY}`, { headers: { 'If-None-Match': etag } }), env);
    expect(second.status).toBe(304);
    expect(second.headers.get('ETag')).toBe(etag);
    expect(second.headers.get('Content-Length')).toBeNull();
    expect(await second.text()).toBe('');
  });

  it('decodes an encoded permalink to the same object', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req(`/evidence/${BODY_KEY.replace(/:/g, '%3A')}`), env);
    expect(res.status).toBe(200);
    expect(env.ARTIFACTS.calls.map((c) => c[1])).toEqual([BODY_KEY]);
  });

  it('never asks the bucket about a path that is not a key', async () => {
    const env = envWith(objects());
    // The URL parser resolves dot-segments, literal or percent-encoded, before
    // the route sees the path: /evidence/raw/../x and /evidence/raw/%2e%2e/x
    // both arrive as /evidence/x, a key that is still under the prefix. The
    // refusal of ".." inside keyFromPath is defence in depth, asserted directly
    // above; what is asserted here is that a path the parser leaves alone and
    // that is not a key never reaches the bucket.
    for (const bad of ['/evidence/', '/evidence/.hidden', '/evidence/raw//x', '/evidence/raw/x/']) {
      const res = await handleEvidence(req(bad), env);
      expect(res.status, bad).toBe(404);
    }
    expect(env.ARTIFACTS.calls).toEqual([]);
  });

  it('ignores a query string: the path names the key and nothing else does', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req(`/evidence/${BODY_KEY}?download=1&x=y`), env);
    expect(res.status).toBe(200);
    expect(env.ARTIFACTS.calls.map((c) => c[1])).toEqual([BODY_KEY]);
  });
});

describe('HEAD, OPTIONS, and everything else', () => {
  it('HEAD returns the headers and no body, from a head call not a get', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req(`/evidence/${BODY_KEY}`, { method: 'HEAD' }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toMatch(/^".+"$/);
    expect(res.headers.get('Content-Length')).toBe('11');
    expect(await res.text()).toBe('');
    expect(env.ARTIFACTS.calls).toEqual([['head', BODY_KEY]]);
  });

  it('HEAD of a missing key is 404', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req('/evidence/raw/e/2026-09-04T11:42:01Z/missing.body', { method: 'HEAD' }), env);
    expect(res.status).toBe(404);
  });

  it('OPTIONS states the read-only surface', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req(`/evidence/${BODY_KEY}`, { method: 'OPTIONS' }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');
    expect(env.ARTIFACTS.calls).toEqual([]);
  });

  it('refuses writes with 405 and never touches the bucket', async () => {
    const env = envWith(objects());
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await handleEvidence(req(`/evidence/${BODY_KEY}`, { method, body: method === 'DELETE' ? undefined : 'x' }), env);
      expect(res.status, method).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');
    }
    expect(env.ARTIFACTS.calls).toEqual([]);
  });
});

describe('the default export', () => {
  it('routes /evidence/* to the bucket and everything else to static assets', async () => {
    const env = envWith(objects());
    const evidence = await worker.fetch(req(`/evidence/${BODY_KEY}`), env);
    expect(evidence.status).toBe(200);
    expect(evidence.headers.get('X-From')).toBeNull();

    const page = await worker.fetch(req('/clusters/'), env);
    expect(page.status).toBe(200);
    expect(page.headers.get('X-From')).toBe('assets');
    expect(env.ASSETS.calls).toEqual(['/clusters/']);
  });

  it('treats a bare /evidence as an evidence request that names no key', async () => {
    const env = envWith(objects());
    const res = await worker.fetch(req('/evidence'), env);
    expect(res.status).toBe(404);
    expect(env.ASSETS.calls).toEqual([]);
    expect(env.ARTIFACTS.calls).toEqual([]);
  });
});
