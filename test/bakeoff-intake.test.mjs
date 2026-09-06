// The Bakeoff intake, /api/bakeoff, in src/worker/index.js.
//
// Written against the default export rather than the handler, because
// handleBakeoff is not exported and because what is under test is as much the
// dispatch as the handler: the failure this replaced was a POST that reached
// the static asset handler and came back 405 with an empty body, so a buyer
// submitted the form on /bakeoff and landed on a blank page.
//
// The env stub records every call, so a test can assert that neither the static
// assets binding nor the artifact bucket was consulted for this path. A
// response that came from ASSETS is the old failure wearing a new status code.
//
// The copy is asserted, not read. Document 07 defines Register D and lists the
// words banned on every product surface; rule 7 says an error states what
// happened and the next action. A buyer who cannot tell from the body that they
// were not billed is the outcome this handler exists to prevent, so that
// sentence is a test rather than a style note.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../src/worker/index.js';

const BAKEOFF_PATHS = ['/api/bakeoff', '/api/bakeoff/', '/api/bakeoff/anything'];

// Every method a plain HTML form, a reload, or a stray client can produce.
const METHODS = ['POST', 'GET', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

// What a browser actually sends on a form post, what a client sends, and the
// degenerate cases. Each one must come back with a body.
const ACCEPT_HEADERS = [
  ['browser form post', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'],
  ['text/html', 'text/html'],
  ['application/json', 'application/json'],
  ['any', '*/*'],
  ['text/plain', 'text/plain'],
  ['form encoded', 'application/x-www-form-urlencoded'],
  ['empty', ''],
  ['absent', null],
];

// Document 07, "Words banned on every product surface".
const BANNED_WORDS = [
  'reseller',
  'wrapper',
  'fake',
  'copy',
  'scam',
  'rip-off',
  'middleman',
  'hidden',
  'secret',
  'exposed',
  'caught',
  'gouging',
  'the same company',
  'deceptive',
  'misleading',
];

// Register D rule 1: the first person appears nowhere on a product surface,
// and there is no we.
const FIRST_PERSON = [/\bI\b/, /\bI'(m|ve|ll|d)\b/i, /\bwe\b/i, /\bwe'(re|ve|ll|d)\b/i, /\bour\b/i, /\bours\b/i, /\bus\b/i, /\bmy\b/i, /\bmine\b/i, /\blet's\b/i];

// Register D: never apologises.
const APOLOGY = [/\bsorry\b/i, /\bapolog/i, /\bunfortunately\b/i, /\bregret\b/i, /\boops\b/i, /\bbear with\b/i, /\bpatience\b/i, /\bexcuse\b/i];

// Document 07 rule 8, no adjectives of scale, plus the launch-copy tics that
// are the same failure in a different costume.
const MARKETING = [
  /\bcomprehensive\b/i,
  /\bextensive\b/i,
  /\bpowerful\b/i,
  /\bthe only\b/i,
  /\bseamless\b/i,
  /\beffortless\b/i,
  /\brevolutionary\b/i,
  /\bworld-class\b/i,
  /\bbest-in-class\b/i,
  /\bcutting-edge\b/i,
  /\bindustry-leading\b/i,
  /\bgame-chang/i,
  /\bexcited\b/i,
  /\bthrilled\b/i,
  /\bstay tuned\b/i,
  /\bcoming soon\b/i,
  /\bamazing\b/i,
  /\bsimply\b/i,
];

// The house rule is a spaced hyphen. Em dash, en dash and horizontal bar are
// all the thing it replaces.
const DASHES = /[–—―−]/;

function envStub() {
  return {
    ARTIFACTS: {
      calls: [],
      async head(key) {
        this.calls.push(['head', key]);
        return null;
      },
      async get(key) {
        this.calls.push(['get', key]);
        return null;
      },
    },
    ASSETS: {
      calls: [],
      async fetch(request) {
        this.calls.push(new URL(request.url).pathname);
        // What the static asset handler did before this handler existed: an
        // empty 405 on a POST to a path that is not a file.
        return new Response(null, { status: 405, headers: { 'X-From': 'assets' } });
      },
    },
  };
}

function request(path, { method = 'POST', accept = null, body } = {}) {
  const init = { method, headers: new Headers() };
  if (accept !== null) init.headers.set('accept', accept);
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') init.body = body;
  return new Request(`https://crosspeel.com${path}`, init);
}

/** A form post as a browser makes it: urlencoded body, browser Accept. */
function formPost(path = '/api/bakeoff') {
  return request(path, {
    method: 'POST',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    body: 'endpoint=https%3A%2F%2Fa.example%2Fx&endpoint=https%3A%2F%2Fb.example%2Fy&email=buyer%40example.com',
  });
}

/** Visible text of an HTML document, with style and script content removed. */
function visibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every string a reader could be shown by this response: the body as sent, and
 * for an HTML page also its visible text, so a banned word cannot hide in a
 * title attribute and a first person cannot hide in a heading.
 */
function readableStrings(body, contentType) {
  const strings = [body];
  if ((contentType || '').includes('text/html')) strings.push(visibleText(body));
  return strings;
}

async function bakeoff(path, opts) {
  const env = envStub();
  const res = await worker.fetch(request(path, opts), env);
  const body = await res.clone().text();
  return { res, body, env };
}

describe('/api/bakeoff is answered, not left to fall through', () => {
  it('answers a form post with 503, not 405 and not 404', async () => {
    const env = envStub();
    const res = await worker.fetch(formPost(), env);
    expect(res.status).toBe(503);
    expect(res.status).not.toBe(405);
    expect(res.status).not.toBe(404);
  });

  it('never reaches the static assets binding or the artifact bucket', async () => {
    const env = envStub();
    const res = await worker.fetch(formPost(), env);
    expect(res.headers.get('X-From')).toBeNull();
    expect(env.ASSETS.calls).toEqual([]);
    expect(env.ARTIFACTS.calls).toEqual([]);
  });

  it('answers /api/bakeoff, /api/bakeoff/ and /api/bakeoff/anything alike', async () => {
    for (const path of BAKEOFF_PATHS) {
      const { res, body, env } = await bakeoff(path, { method: 'POST', accept: 'application/json' });
      expect(res.status, path).toBe(503);
      expect(env.ASSETS.calls, path).toEqual([]);
      expect(JSON.parse(body).submitted, path).toBe(false);
    }
  });

  it('answers every method a form, a reload or a stray client can send', async () => {
    for (const method of METHODS) {
      for (const path of BAKEOFF_PATHS) {
        const { res, env } = await bakeoff(path, { method, accept: 'application/json' });
        expect(res.status, `${method} ${path}`).toBe(503);
        expect(res.headers.get('X-From'), `${method} ${path}`).toBeNull();
        expect(env.ASSETS.calls, `${method} ${path}`).toEqual([]);
      }
    }
  });

  it('answers the GET a buyer sends by reloading after submitting', async () => {
    // The specific case the dispatch comment names. A reload of the POST result
    // is a GET, and a blank 405 on that is the same silence as before.
    const { res, body } = await bakeoff('/api/bakeoff', { method: 'GET', accept: 'text/html' });
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/nothing was submitted/i);
    expect(body).toMatch(/nothing was charged/i);
  });

  it('leaves neighbouring paths to the static site', async () => {
    for (const path of ['/api/bakeoffs', '/api/bakeoff-extra', '/api', '/bakeoff/', '/api/bakeoffx']) {
      const env = envStub();
      const res = await worker.fetch(request(path, { method: 'GET' }), env);
      expect(res.headers.get('X-From'), path).toBe('assets');
      expect(env.ASSETS.calls, path).toEqual([path]);
    }
  });
});

describe('the body is never empty', () => {
  it('returns a body under every Accept header, on every path, for every method with one', async () => {
    for (const [label, accept] of ACCEPT_HEADERS) {
      for (const path of BAKEOFF_PATHS) {
        for (const method of ['POST', 'GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
          const { res, body } = await bakeoff(path, { method, accept });
          const where = `${method} ${path} accept=${label}`;
          expect(res.status, where).toBe(503);
          expect(body.length, where).toBeGreaterThan(0);
          expect(body.trim(), where).not.toBe('');
        }
      }
    }
  });

  it('answers HEAD with the same status and content type, the body being stripped on the wire', async () => {
    // A HEAD response carries no body by definition. What is asserted here is
    // that HEAD is answered by this handler rather than falling through, and
    // that it describes the same resource a GET would return.
    for (const accept of ['text/html', 'application/json', null]) {
      const { res, env } = await bakeoff('/api/bakeoff', { method: 'HEAD', accept });
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-type')).toBeTruthy();
      expect(env.ASSETS.calls).toEqual([]);
    }
  });
});

describe('content negotiation', () => {
  it('returns an HTML page when the request accepts HTML', async () => {
    for (const accept of [
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'text/html',
      'text/html; charset=utf-8',
    ]) {
      const { res, body } = await bakeoff('/api/bakeoff', { method: 'POST', accept });
      expect(res.status, accept).toBe(503);
      expect(res.headers.get('content-type'), accept).toBe('text/html; charset=utf-8');
      expect(body.trimStart().slice(0, 15).toLowerCase(), accept).toContain('<!doctype html');
      expect(body, accept).toMatch(/<title>[^<]+<\/title>/);
      expect(body, accept).toMatch(/<\/html>\s*$/);
      expect(visibleText(body).length, accept).toBeGreaterThan(80);
    }
  });

  it('returns valid JSON when the request does not accept HTML', async () => {
    for (const [label, accept] of ACCEPT_HEADERS.filter(([, a]) => !(a || '').includes('text/html'))) {
      const { res, body } = await bakeoff('/api/bakeoff', { method: 'POST', accept });
      expect(res.headers.get('content-type'), label).toBe('application/json; charset=utf-8');
      expect(() => JSON.parse(body), label).not.toThrow();
      expect(body.trimStart()[0], label).toBe('{');
    }
  });

  it('says submitted false and charged false, as booleans', async () => {
    for (const path of BAKEOFF_PATHS) {
      for (const method of ['POST', 'GET', 'PUT', 'DELETE']) {
        const { body } = await bakeoff(path, { method, accept: 'application/json' });
        const json = JSON.parse(body);
        const where = `${method} ${path}`;
        expect(json.submitted, where).toBe(false);
        expect(json.charged, where).toBe(false);
        expect(typeof json.submitted, where).toBe('boolean');
        expect(typeof json.charged, where).toBe('boolean');
        expect(typeof json.message, where).toBe('string');
        expect(json.message.length, where).toBeGreaterThan(0);
      }
    }
  });

  it('carries a machine-readable state and a contact address in the JSON', async () => {
    const { body } = await bakeoff('/api/bakeoff', { method: 'POST', accept: 'application/json' });
    const json = JSON.parse(body);
    expect(typeof json.status).toBe('string');
    expect(json.status.length).toBeGreaterThan(0);
    expect(json.contact).toMatch(/@/);
  });
});

describe('the buyer can tell they were not billed', () => {
  it('states plainly that nothing was submitted and nothing was charged, in both representations', async () => {
    for (const [label, accept] of ACCEPT_HEADERS) {
      for (const path of BAKEOFF_PATHS) {
        const { res, body } = await bakeoff(path, { method: 'POST', accept });
        const where = `${path} accept=${label}`;
        const text = (res.headers.get('content-type') || '').includes('text/html')
          ? visibleText(body)
          : JSON.parse(body).message;
        expect(text, where).toMatch(/nothing was submitted/i);
        expect(text, where).toMatch(/nothing was charged/i);
      }
    }
  });

  it('does not qualify the charge statement with a maybe', async () => {
    for (const accept of ['text/html', 'application/json']) {
      const { body } = await bakeoff('/api/bakeoff', { method: 'POST', accept });
      expect(body, accept).not.toMatch(/may have been charged/i);
      expect(body, accept).not.toMatch(/might have been charged/i);
      expect(body, accept).not.toMatch(/check your (card|statement|bank)/i);
    }
  });
});

describe('the response is never cached', () => {
  it('carries cache-control no-store on every path, method and Accept', async () => {
    for (const [label, accept] of ACCEPT_HEADERS) {
      for (const path of BAKEOFF_PATHS) {
        for (const method of METHODS) {
          const { res } = await bakeoff(path, { method, accept });
          const where = `${method} ${path} accept=${label}`;
          expect(res.headers.get('cache-control'), where).toBe('no-store');
        }
      }
    }
  });

  it('states no cache lifetime by any other route', async () => {
    // A "not open yet" page served from a cache after it opens is a lie, so
    // neither an Expires date nor a positive max-age may appear alongside it.
    const { res } = await bakeoff('/api/bakeoff', { method: 'POST', accept: 'text/html' });
    expect(res.headers.get('cache-control')).not.toMatch(/max-age=[1-9]/);
    expect(res.headers.get('expires')).toBeNull();
    expect(res.headers.get('etag')).toBeNull();
  });

  it('is served as data with the same protections as the rest of the origin', async () => {
    const { res } = await bakeoff('/api/bakeoff', { method: 'POST', accept: 'text/html' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });
});

describe('Register D - document 07', () => {
  it('uses no word banned on a product surface', async () => {
    for (const [label, accept] of ACCEPT_HEADERS) {
      for (const path of BAKEOFF_PATHS) {
        const { res, body } = await bakeoff(path, { method: 'POST', accept });
        for (const candidate of readableStrings(body, res.headers.get('content-type'))) {
          for (const word of BANNED_WORDS) {
            const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            expect(pattern.test(candidate), `${word} in ${path} accept=${label}`).toBe(false);
          }
        }
      }
    }
  });

  it('contains no em dash, en dash or horizontal bar', async () => {
    for (const [label, accept] of ACCEPT_HEADERS) {
      for (const path of BAKEOFF_PATHS) {
        const { body } = await bakeoff(path, { method: 'POST', accept });
        expect(DASHES.test(body), `${path} accept=${label}`).toBe(false);
        expect(body.includes('—'), `${path} accept=${label}`).toBe(false);
      }
    }
  });

  it('uses no first person, singular or plural', async () => {
    for (const [label, accept] of ACCEPT_HEADERS) {
      const { res, body } = await bakeoff('/api/bakeoff', { method: 'POST', accept });
      for (const candidate of readableStrings(body, res.headers.get('content-type'))) {
        for (const pattern of FIRST_PERSON) {
          expect(pattern.test(candidate), `${pattern} accept=${label}`).toBe(false);
        }
      }
    }
  });

  it('does not apologise', async () => {
    for (const [label, accept] of ACCEPT_HEADERS) {
      const { res, body } = await bakeoff('/api/bakeoff', { method: 'POST', accept });
      for (const candidate of readableStrings(body, res.headers.get('content-type'))) {
        for (const pattern of APOLOGY) {
          expect(pattern.test(candidate), `${pattern} accept=${label}`).toBe(false);
        }
      }
    }
  });

  it('does not sell', async () => {
    for (const [label, accept] of ACCEPT_HEADERS) {
      const { res, body } = await bakeoff('/api/bakeoff', { method: 'POST', accept });
      for (const candidate of readableStrings(body, res.headers.get('content-type'))) {
        for (const pattern of MARKETING) {
          expect(pattern.test(candidate), `${pattern} accept=${label}`).toBe(false);
        }
      }
    }
  });

  it('gives a next action, per rule 7', async () => {
    // "State what happened and the next action." The what-happened is asserted
    // above. This is the next action: somewhere to write, and somewhere to read
    // in the meantime.
    for (const [label, accept] of ACCEPT_HEADERS) {
      const { res, body } = await bakeoff('/api/bakeoff', { method: 'POST', accept });
      const isHtml = (res.headers.get('content-type') || '').includes('text/html');
      const text = isHtml ? visibleText(body) : JSON.parse(body).message;
      expect(text, `contact ${label}`).toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(text, `imperative ${label}`).toMatch(/\bwrite to\b/i);
      expect(body, `method link ${label}`).toMatch(/\/method/);
      expect(body, `endpoints link ${label}`).toMatch(/\/endpoints/);
      if (isHtml) expect(body, 'mailto').toMatch(/mailto:/);
    }
  });

  it('is sentence case in the visible headings, per rule 9', async () => {
    const { body } = await bakeoff('/api/bakeoff', { method: 'POST', accept: 'text/html' });
    const headings = [...body.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => visibleText(m[1]));
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading, heading).not.toBe(heading.toUpperCase());
      // Every word after the first that is capitalised must be a proper noun.
      const suspect = heading
        .split(/\s+/)
        .slice(1)
        .filter((w) => /^[A-Z][a-z]+$/.test(w) && !['Bakeoff', 'Crosspeel'].includes(w));
      expect(suspect, heading).toEqual([]);
    }
  });
});

describe('the evidence route is untouched by the dispatch change', () => {
  const KEY = 'raw/01a06c2a-16cd-7dfa-9d79-4e6edf6bef9f/2026-09-04T11:42:01Z/01a06c39-c79c-7ff4-983d-97170743f649.body';

  it('still routes /evidence/* to the bucket and not to the bakeoff handler', async () => {
    const env = envStub();
    const res = await worker.fetch(request(`/evidence/${KEY}`, { method: 'GET' }), env);
    // The stub bucket holds nothing, so 404 from the evidence route is correct.
    // What matters is that the bucket was asked and the bakeoff copy is absent.
    expect(env.ARTIFACTS.calls).toEqual([['get', KEY]]);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('No stored artifact');
  });

  it('still refuses a write to /evidence with 405, which the bakeoff path must not borrow', async () => {
    const env = envStub();
    const res = await worker.fetch(request(`/evidence/${KEY}`, { method: 'POST', body: 'x' }), env);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('still sends an ordinary page to the static assets binding', async () => {
    const env = envStub();
    const res = await worker.fetch(request('/clusters/', { method: 'GET' }), env);
    expect(res.headers.get('X-From')).toBe('assets');
    expect(env.ASSETS.calls).toEqual(['/clusters/']);
  });
});

describe('wrangler.json invokes the Worker for this path', () => {
  // Without this the handler is never reached in production and the fix does
  // nothing: the static asset handler answers first, exactly as before.
  const config = JSON.parse(readFileSync(new URL('../wrangler.json', import.meta.url), 'utf8'));
  const patterns = config.assets?.run_worker_first ?? [];

  const matches = (pattern, path) => {
    if (typeof pattern !== 'string' || pattern.startsWith('!')) return false;
    const source = `^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`;
    return new RegExp(source).test(path);
  };

  it('is an array of positive patterns', () => {
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('covers /api/bakeoff, /api/bakeoff/ and /api/bakeoff/anything', () => {
    for (const path of BAKEOFF_PATHS) {
      expect(patterns.some((p) => matches(p, path)), `${path} not covered by ${JSON.stringify(patterns)}`).toBe(true);
    }
  });

  it('still covers the evidence prefix', () => {
    expect(patterns.some((p) => matches(p, '/evidence/raw/a/b/c.body'))).toBe(true);
  });

  it('does not widen to the whole site', () => {
    expect(patterns).not.toContain('/*');
    expect(patterns.some((p) => matches(p, '/clusters/'))).toBe(false);
    expect(patterns.some((p) => matches(p, '/bakeoff/'))).toBe(false);
  });
});
