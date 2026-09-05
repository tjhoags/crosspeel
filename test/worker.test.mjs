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
const SVG_SOURCE_KEY = 'sources/01a06c2a-1000-7000-8000-000000000001/raw';
const UPLOADED = new Date('2026-09-04T12:00:00Z');

function fakeObject(key, bytes, { contentType, uploaded } = {}) {
  const etag = `"${key.length}-${bytes.length}"`;
  return {
    key,
    size: bytes.length,
    httpEtag: etag,
    etag: etag.replace(/"/g, ''),
    uploaded: uploaded ?? UPLOADED,
    httpMetadata: contentType ? { contentType } : {},
    writeHttpMetadata(headers) {
      if (contentType) headers.set('Content-Type', contentType);
    },
  };
}

function etagListIncludes(list, etag) {
  return list.split(',').some((s) => s.trim() === '*' || s.trim() === etag);
}

/**
 * A bucket that records every call, so a test can assert it was not consulted,
 * and that evaluates the four conditional headers the way R2 does: any failed
 * precondition returns the object without a body.
 */
function fakeBucket(objects, { throwOn = new Set() } = {}) {
  const calls = [];
  return {
    calls,
    async head(key) {
      calls.push(['head', key]);
      if (throwOn.has(key)) throw new Error('R2 unavailable');
      const o = objects.get(key);
      return o ? fakeObject(key, o.bytes, o) : null;
    },
    async get(key, opts = {}) {
      calls.push(['get', key, opts]);
      if (throwOn.has(key)) throw new Error('R2 unavailable');
      const o = objects.get(key);
      if (!o) return null;
      const obj = fakeObject(key, o.bytes, o);
      const h = opts.onlyIf && typeof opts.onlyIf.get === 'function' ? opts.onlyIf : null;
      if (h) {
        const ifMatch = h.get('If-Match');
        if (ifMatch !== null && !etagListIncludes(ifMatch, obj.httpEtag)) return { ...obj, body: null };
        const ifUnmod = h.get('If-Unmodified-Since');
        if (ifUnmod !== null && !Number.isNaN(Date.parse(ifUnmod)) && obj.uploaded.getTime() > Date.parse(ifUnmod)) {
          return { ...obj, body: null };
        }
        const ifNoneMatch = h.get('If-None-Match');
        if (ifNoneMatch !== null && etagListIncludes(ifNoneMatch, obj.httpEtag)) return { ...obj, body: null };
      }
      return { ...obj, body: o.bytes };
    },
  };
}

function envWith(objects, bucketOpts) {
  return {
    ARTIFACTS: fakeBucket(objects, bucketOpts),
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
    [SVG_SOURCE_KEY, { bytes: enc('<svg onload="alert(1)"/>'), contentType: 'image/svg+xml' }],
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

  it('refuses a key R2 would refuse, over 1024 bytes, before it reaches the bucket', () => {
    const long = `raw/${'a'.repeat(1100)}`;
    expect(keyFromPath(`/evidence/${long}`)).toBeNull();
    const atLimit = `raw/${'a'.repeat(1024 - 4)}`;
    expect(keyFromPath(`/evidence/${atLimit}`)).toBe(atLimit);
  });
});

describe('contentTypeFor - served as data, never as a page', () => {
  it('honours a stored type only when it is one of the data types', () => {
    expect(contentTypeFor(BODY_KEY, 'application/json')).toBe('application/json');
    expect(contentTypeFor(BODY_KEY, 'application/json; charset=utf-8')).toBe('application/json');
    expect(contentTypeFor(BODY_KEY, 'text/plain')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor(BODY_KEY, 'application/octet-stream')).toBe('application/octet-stream');
  });

  it('never returns a renderable type whatever the object claims', () => {
    for (const stored of [
      'text/html',
      'text/html; charset=utf-8',
      'TEXT/HTML; charset=utf-8',
      '\ttext/html',
      ' text/html ',
      'application/xhtml+xml',
      'application/xml',
      'text/xml',
      'image/svg+xml',
      'application/rss+xml',
      'application/json, text/html',
    ]) {
      expect(contentTypeFor(BODY_KEY, stored), JSON.stringify(stored)).toBe('application/octet-stream');
      expect(contentTypeFor(SVG_SOURCE_KEY, stored), JSON.stringify(stored)).toBe('application/octet-stream');
    }
  });

  it('uses the last comma-separated member, as a browser does, and never echoes the stored string', () => {
    expect(contentTypeFor(BODY_KEY, 'text/html, application/json')).toBe('application/json');
    expect(contentTypeFor(BODY_KEY, 'application/json, text/html')).toBe('application/octet-stream');
  });

  it('derives a type from the key when the object carries none or an unservable one', () => {
    expect(contentTypeFor(HEADERS_KEY, null)).toBe('application/json; charset=utf-8');
    expect(contentTypeFor(HEADERS_KEY, 'text/html')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor(BODY_KEY, undefined)).toBe('application/octet-stream');
    expect(contentTypeFor('reports/x.html', '')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('reports/x.html', 'text/html')).toBe('text/plain; charset=utf-8');
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
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(await res.text()).toBe('<script>alert(1)</script>');
  });

  it('never serves a snapshotted source as SVG or any other document type', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req(`/evidence/${SVG_SOURCE_KEY}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
  });

  it('returns 404, uncached, for a key that is not in the bucket', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req('/evidence/raw/e/2026-09-04T11:42:01Z/missing.body'), env);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toContain('No stored artifact');
  });

  it('returns 500, uncached, with the security headers, when the bucket throws', async () => {
    const env = envWith(objects(), { throwOn: new Set([BODY_KEY]) });
    const res = await handleEvidence(req(`/evidence/${BODY_KEY}`), env);
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    const head = await handleEvidence(req(`/evidence/${BODY_KEY}`, { method: 'HEAD' }), env);
    expect(head.status).toBe(500);
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
    for (const bad of ['/evidence/', '/evidence/.hidden', '/evidence/raw//x', '/evidence/raw/x/', `/evidence/raw/${'a'.repeat(1100)}`]) {
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

describe('conditional requests, in RFC 9110 order', () => {
  it('answers a matching If-None-Match with 304 and no body', async () => {
    const env = envWith(objects());
    const first = await handleEvidence(req(`/evidence/${BODY_KEY}`), env);
    const etag = first.headers.get('ETag');
    const second = await handleEvidence(req(`/evidence/${BODY_KEY}`, { headers: { 'If-None-Match': etag } }), env);
    expect(second.status).toBe(304);
    expect(second.headers.get('ETag')).toBe(etag);
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(second.headers.get('Content-Length')).toBeNull();
    expect(await second.text()).toBe('');
  });

  it('answers a failed If-Match with 412, no body, and no caching', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(req(`/evidence/${BODY_KEY}`, { headers: { 'If-Match': '"wrong"' } }), env);
    expect(res.status).toBe(412);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Length')).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('a failed If-Match is 412 even when If-None-Match would otherwise hold', async () => {
    const env = envWith(objects());
    const first = await handleEvidence(req(`/evidence/${BODY_KEY}`), env);
    const etag = first.headers.get('ETag');
    const res = await handleEvidence(
      req(`/evidence/${BODY_KEY}`, { headers: { 'If-Match': '"wrong"', 'If-None-Match': etag } }),
      env,
    );
    expect(res.status).toBe(412);
  });

  it('a holding If-Match serves the object', async () => {
    const env = envWith(objects());
    const first = await handleEvidence(req(`/evidence/${BODY_KEY}`), env);
    const etag = first.headers.get('ETag');
    for (const value of [etag, '*', `"other", ${etag}`]) {
      const res = await handleEvidence(req(`/evidence/${BODY_KEY}`, { headers: { 'If-Match': value } }), env);
      expect(res.status, value).toBe(200);
    }
  });

  it('answers a failed If-Unmodified-Since with 412', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(
      req(`/evidence/${BODY_KEY}`, { headers: { 'If-Unmodified-Since': 'Sat, 01 Jan 2000 00:00:00 GMT' } }),
      env,
    );
    expect(res.status).toBe(412);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('a holding If-Unmodified-Since serves the object', async () => {
    const env = envWith(objects());
    const res = await handleEvidence(
      req(`/evidence/${BODY_KEY}`, { headers: { 'If-Unmodified-Since': 'Fri, 04 Sep 2026 12:00:00 GMT' } }),
      env,
    );
    expect(res.status).toBe(200);
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
