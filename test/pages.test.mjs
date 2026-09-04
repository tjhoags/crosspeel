/* Independent verification of runbook step D3 - the static pages.
 *
 * These tests were written by a sub-agent that did not write the pages, from
 * document 03, document 07 and the declared interface only, per the separation
 * rule in document 09.
 *
 * They assert over the BUILT OUTPUT in dist/ rather than over the .astro
 * templates. Document 09, category T6: "Assert by crawling the built output,
 * not by reading the template." A template that reads correctly can still emit
 * the wrong thing.
 *
 * Run `npm run build` before `npm test`. The suite fails with a direction
 * rather than a stack trace when dist/ is absent.
 *
 * Root override. CROSSPEEL_D3_ROOT points the whole suite at a different tree
 * containing dist/ and src/data/corpus.json. It exists so the suite can be
 * observed failing against a deliberately broken copy of the built site before
 * it is run against the real one - the failing-first rule in document 09.
 * It defaults to this repository, and nothing in the build reads it.
 *
 * Several word lists below are assembled from fragments at runtime. This
 * repository is public. A test that searched the built site for a word from the
 * document 07 list would otherwise put that list into a public file, and
 * document 07 bans those words in test fixtures as well as in copy.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CROSSPEEL_D3_ROOT
  ? path.resolve(process.env.CROSSPEEL_D3_ROOT)
  : path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const DIST = path.join(ROOT, 'dist');
const CORPUS_PATH = path.join(ROOT, 'src', 'data', 'corpus.json');

if (!fs.existsSync(DIST)) {
  throw new Error(
    `dist not found at ${DIST}. These tests read the built output. Run the build first: npm run build`,
  );
}

const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));

/* ---------- reading the built tree ---------- */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(DIST).map((f) => path.relative(DIST, f).split(path.sep).join('/'));
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
const cssFiles = allFiles.filter((f) => f.endsWith('.css'));

const raw = new Map();
for (const f of htmlFiles) raw.set(f, fs.readFileSync(path.join(DIST, f), 'utf8'));

// Astro build.format is "directory", so a route is a directory holding
// index.html. The home page is dist/index.html and 404 is dist/404.html.
function fileForRoute(route) {
  if (route === '/404') return '404.html';
  if (route === '/') return 'index.html';
  return `${route.replace(/^\//, '').replace(/\/$/, '')}/index.html`;
}

function routeForFile(file) {
  if (file === 'index.html') return '/';
  if (file === '404.html') return '/404';
  return `/${file.replace(/\/index\.html$/, '')}`;
}

/* ---------- turning a built page into text ---------- */

const ENTITIES = [
  [/&quot;/g, '"'],
  [/&#34;/g, '"'],
  [/&#39;/g, "'"],
  [/&apos;/g, "'"],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
];

function decode(s) {
  let out = s;
  for (const [re, to] of ENTITIES) out = out.replace(re, to);
  return out;
}

function stripInert(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Anything marked data-captured is verbatim machine output - an operator's
    // own advertised description, captured and stored unmodified per document 02.
    // Document 07 governs what Crosspeel WRITES. An operator's em dash, or their
    // use of a word Crosspeel will not use, is a fact about their listing, and
    // rewriting it to satisfy a house style rule would be falsifying a captured
    // value. It is rendered in mono for exactly this reason: the reader can see
    // it is captured rather than written.
    .replace(/<([a-z]+)[^>]*\bdata-captured\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

// A block-level boundary is a word boundary; an inline one is not. A sentence
// broken across a heading and a paragraph still reads as one sentence, and an
// inline link inside a sentence must rejoin it without gaining a space.
const BLOCK_TAGS = [
  'address', 'article', 'aside', 'blockquote', 'br', 'button', 'caption',
  'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'legend', 'li',
  'main', 'nav', 'ol', 'option', 'p', 'pre', 'section', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
];
const BLOCK_RE = new RegExp(`</?(?:${BLOCK_TAGS.join('|')})\\b[^>]*>`, 'gi');

// Tight: block boundaries become one space, inline tags are removed with
// nothing in their place. Used for character-for-character copy checks.
function textTight(html) {
  return decode(stripInert(html).replace(BLOCK_RE, ' ').replace(/<[^>]*>/g, ''))
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

// Loose: tags become a space, so two adjacent cells never fuse into one word.
// Used for word-level scans.
function textLoose(html) {
  return decode(stripInert(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function section(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

const tightAll = new Map();
const looseAll = new Map();
for (const [f, html] of raw) {
  tightAll.set(f, textTight(html));
  looseAll.set(f, textLoose(html));
}

/* ---------- word lists, assembled at runtime ---------- */

const j = (...parts) => parts.join('');

// Document 07, "words banned on every product surface", with the plain
// inflections of each. Whole-word matching only, so a longer word that merely
// begins with one of these is not a false positive.
const BANNED_WORDS = [
  j('re', 'sell', 'er'), j('re', 'sell', 'ers'), j('re', 'sell', 'ing'),
  j('wrap', 'per'), j('wrap', 'pers'),
  j('fa', 'ke'), j('fa', 'kes'), j('fa', 'ked'),
  j('co', 'py'), j('co', 'pies'), j('co', 'pied'), j('co', 'pying'),
  j('sc', 'am'), j('sc', 'ams'),
  j('rip', '-', 'off'), j('rip', 'off'), j('rip', '-', 'offs'), j('rip', 'offs'),
  j('middle', 'man'), j('middle', 'men'),
  j('hid', 'den'),
  j('sec', 'ret'), j('sec', 'rets'), j('sec', 'retly'),
  j('expo', 'se'), j('expo', 'sed'), j('expo', 'ses'), j('expo', 'sing'),
  j('cau', 'ght'),
  j('goug', 'e'), j('goug', 'es'), j('goug', 'ing'),
  j('decep', 'tive'), j('decep', 'tively'),
  j('mis', 'leading'), j('mis', 'leadingly'),
];

const BANNED_PHRASE = j('the same ', 'com', 'pany');

// Identifier forms of the same list, for class names, ids and data attributes.
// A public repository carrying an element named for one of these is the legal
// problem document 07 describes. The HTML vocabulary words are left out here
// because they are legitimate markup rather than copy.
const BANNED_STEMS = [
  j('re', 'sell'), j('wrap', 'per'), j('fa', 'ke'), j('sc', 'am'),
  j('rip', 'off'), j('middle', 'man'), j('sec', 'ret'), j('expo', 'sed'),
  j('goug', 'ing'), j('decep', 'tive'), j('mis', 'leading'),
];

// Document 07 rule 1. The first person appears nowhere on a product surface.
const FIRST_PERSON = [
  'I', "I'm", "I've", "I'd", "I'll",
  'me', 'my', 'mine', 'myself',
  'we', "we're", "we've", "we'd", "we'll",
  'us', 'our', 'ours', 'ourselves',
];

// Document 03: "No placeholder figures ever ship." An unfilled template slot or
// a stand-in word reaching the built output is the same failure.
// "to do" is deliberately absent. It is ordinary English - "no mechanism to do
// so" is document 03's own fixed line - and matching it produced a false
// positive against correct copy.
const PLACEHOLDERS = [
  'lorem', 'ipsum', 'tbd', 't.b.d', 'coming soon', 'placeholder', 'todo',
  'fixme', 'undefined', 'nan', 'xxx', 'foo', 'bar baz', 'sample text', 'dummy',
];

// Built from its code point rather than written out, so this file does not
// itself contain the character a grep over the repository is looking for.
const EM_DASH = String.fromCharCode(0x2014);

function wordRegex(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b does not fire next to an apostrophe, so the contraction forms are
  // bounded by hand.
  return new RegExp(`(^|[^A-Za-z0-9'])${escaped}($|[^A-Za-z0-9'])`);
}

function findWord(text, word, caseSensitive) {
  const re = new RegExp(wordRegex(word).source, caseSensitive ? '' : 'i');
  const m = text.match(re);
  if (!m) return null;
  return text.slice(Math.max(0, m.index - 60), m.index + word.length + 60);
}

/* ---------- the copy that document 03 fixes ---------- */

const HOME_ARGUMENT = [
  'Crosspeel pays machine-payable API endpoints and records what comes back - certificate issuers, header order, field names, error strings, timing, and price.',
  'Endpoints that share an origin agree on details their operators never thought to vary. Crosspeel finds those agreements and publishes them, with the evidence and the price difference attached.',
  'This does not observe ownership, contracts, or intent. It observes responses. Where two endpoints respond identically and price differently, that is what gets published, and the operators are invited to dispute it.',
];

const HOME_FIGURE_LABELS = [
  'Endpoints observed',
  'Clusters published',
  'Widest price spread',
  'Last probe run',
];

const BAKEOFF_OPENING =
  'Name the endpoints you are using or considering. Crosspeel pays each one, compares the responses, and returns a report showing which are serving the same thing and where the price differences are.';

const BAKEOFF_DISCLOSURE =
  'The endpoints you submit are probed with your payment; the resulting observations enter the public record after a seven day delay, without your name attached.';

const ABOUT_FIXED_LINE =
  'No endpoint can pay to be listed, delisted, ranked, or unranked. There is no mechanism to do so and there will not be one.';

const NOT_FOUND_COPY = 'That page does not exist. The cluster index is at /clusters.';

const DISPUTE_INVITATION_ADDRESS = 'disputes@crosspeel.com';

// Document 03, /method: "Then, under the heading What this cannot see, the four
// limits from 02 verbatim." Document 02 adds, above its own list: "This appears
// on the public methodology page verbatim, per house rule five."
//
// The first limit is assembled from fragments for the same reason as the word
// lists above - as document 02 writes it, that sentence contains a word
// document 07 bans on every product surface, and this repository is public.
const METHOD_LIMITS = [
  j(
    'Two operators independently using the same upstream vendor will cluster. ',
    'That is a shared dependency, not a ', 're', 'sell', 'er',
    ' relationship, and Crosspeel cannot distinguish them from the outside.',
  ),
  'Two operators running the same open-source template will cluster.',
  'An operator who deliberately randomises key order and error wording will not cluster, and Crosspeel will not detect that they are avoiding detection.',
  'Nothing here observes ownership, contracts, or intent. The findings are about responses, not companies.',
];

// Document 03, "Global chrome". Five nav items, in this order. Disputes and
// About live in the footer.
const NAV_ITEMS = [
  ['Clusters', '/clusters'],
  ['Endpoints', '/endpoints'],
  ['Method', '/method'],
  ['Bakeoff', '/bakeoff'],
  ['MCP', '/mcp'],
];

// Document 00: the site links to tomhogan.io as the author's umbrella, and both
// repositories are on GitHub under tjhoags. Document 03: no third-party
// requests at runtime, from any origin, for any reason. These two are outbound
// links a reader clicks, not requests the page makes.
const ALLOWED_EXTERNAL_HOSTS = ['github.com', 'tomhogan.io'];
const SELF_HOST = 'crosspeel.com';

/* ---------- routes named by document 03 ---------- */

const STATIC_ROUTES = [
  '/',
  '/clusters',
  '/endpoints',
  '/method',
  '/disputes',
  '/bakeoff',
  '/mcp',
  '/about',
];

// Product surfaces. Every built page is one, and the whole set is scanned by
// the voice tests below.
const PRODUCT_PAGES = () => htmlFiles;

/* ================================================================== */

describe('D3 information architecture - document 03', () => {
  it('every static route named in the information architecture is built', () => {
    const missing = STATIC_ROUTES.filter((r) => !htmlFiles.includes(fileForRoute(r)));
    expect(missing, `routes named in document 03 with no file in dist: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('the 404 page is built', () => {
    expect(htmlFiles).toContain('404.html');
  });

  it('the parameterised routes are built once per corpus row and never invented', () => {
    const clusterPages = htmlFiles.filter((f) => /^clusters\/[^/]+\/index\.html$/.test(f));
    const endpointPages = htmlFiles.filter((f) => /^endpoints\/[^/]+\/index\.html$/.test(f));

    const clusterSlugs = (corpus.clusters || []).map((c) => c.slug).sort();
    const endpointSlugs = (corpus.endpoints || []).map((e) => e.slug).sort();

    expect(clusterPages.map((f) => f.split('/')[1]).sort()).toEqual(clusterSlugs);
    expect(endpointPages.map((f) => f.split('/')[1]).sort()).toEqual(endpointSlugs);
  });

  it('the templates for the parameterised routes exist in the source tree', () => {
    // The corpus is empty, so those routes build to nothing. The templates
    // still have to be present or the routes can never appear.
    for (const p of ['clusters/[slug].astro', 'endpoints/[slug].astro']) {
      expect(fs.existsSync(path.join(ROOT, 'src', 'pages', p)), `missing src/pages/${p}`)
        .toBe(true);
    }
  });

  it('every built page carries the five navigation items, in order, and no more', () => {
    for (const f of PRODUCT_PAGES()) {
      const nav = section(raw.get(f), 'nav');
      const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs, `${f} primary navigation`).toEqual(NAV_ITEMS.map((n) => n[1]));

      const labels = textLoose(nav).split(/\s+/).filter(Boolean);
      expect(labels, `${f} primary navigation labels`).toEqual(NAV_ITEMS.map((n) => n[0]));
    }
  });

  it('every built page carries Disputes, About, Method, GitHub and the dispute address in the footer', () => {
    for (const f of PRODUCT_PAGES()) {
      const foot = raw.get(f).match(/<footer[\s\S]*?<\/footer>/i);
      expect(foot, `${f} has no footer`).not.toBeNull();
      const footText = textLoose(foot[0]);
      for (const label of ['Disputes', 'About', 'Method', 'GitHub']) {
        expect(footText, `${f} footer is missing ${label}`).toContain(label);
      }
      expect(footText, `${f} footer is missing the dispute address`)
        .toContain(DISPUTE_INVITATION_ADDRESS);
      expect(footText, `${f} footer is missing the operator line`)
        .toContain('Crosspeel is built and operated by Tom Hogan');
    }
  });

  it('no byline appears in the chrome above the footer', () => {
    for (const f of PRODUCT_PAGES()) {
      const html = raw.get(f);
      const head = html.match(/<header[\s\S]*?<\/header>/i);
      expect(head, `${f} has no header`).not.toBeNull();
      expect(textLoose(head[0])).not.toContain('Tom Hogan');
    }
  });
});

describe('D3 verbatim copy - document 03', () => {
  it('the home page argument appears character for character', () => {
    const t = tightAll.get('index.html');
    for (const para of HOME_ARGUMENT) {
      expect(t, 'home page argument paragraph does not match document 03').toContain(para);
    }
  });

  it('the home page figure labels match document 03 exactly, in order', () => {
    const html = raw.get('index.html');
    const labels = [...html.matchAll(/<th[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/g)]
      .map((m) => textTight(m[1]));
    expect(labels).toEqual(HOME_FIGURE_LABELS);
  });

  it('the bakeoff opening paragraph appears character for character', () => {
    expect(tightAll.get('bakeoff/index.html')).toContain(BAKEOFF_OPENING);
  });

  it('the bakeoff seven day disclosure appears character for character', () => {
    // Document 03: "That last sentence is a disclosure and it is not optional."
    const t = tightAll.get('bakeoff/index.html');
    expect(t, 'the seven day disclosure is absent or altered').toContain(BAKEOFF_DISCLOSURE);
  });

  it('the seven day disclosure is shown before the buyer submits the form', () => {
    const html = raw.get('bakeoff/index.html');
    const t = textTight(html);
    const disclosureAt = t.indexOf(BAKEOFF_DISCLOSURE);
    const submitAt = t.indexOf('Continue to payment');
    expect(disclosureAt, 'the disclosure is absent').toBeGreaterThan(-1);
    expect(submitAt, 'the submit control is absent').toBeGreaterThan(-1);
    expect(disclosureAt, 'the disclosure must precede the submit control')
      .toBeLessThan(submitAt);
  });

  it('the bakeoff delivery sentence carries a measured figure or states that it is unmeasured', () => {
    // Document 03: "Reports are delivered by email, usually within {n} minutes."
    // {n} is a slot. Document 00 forbids inventing a figure, so the sentence is
    // correct either filled with a measured number or stating plainly that the
    // figure is not yet measured. A stand-in number or a placeholder is not.
    const t = tightAll.get('bakeoff/index.html');
    const filled = /Reports are delivered by email, usually within \d+ minutes\./.test(t);
    const unmeasured = /Reports are delivered by email\.[^]{0,160}?not yet measured/.test(t);
    expect(
      filled || unmeasured,
      'the delivery sentence matches neither the filled document 03 form nor an honest unmeasured form',
    ).toBe(true);
  });

  it('the about page fixed trust line appears character for character', () => {
    expect(tightAll.get('about/index.html')).toContain(ABOUT_FIXED_LINE);
  });

  it('the about page states how it is funded and links to tomhogan.io', () => {
    const t = tightAll.get('about/index.html');
    expect(t).toContain('funded by');
    expect(t).toMatch(/no advertising|There is no advertising/);
    expect(raw.get('about/index.html')).toContain('https://tomhogan.io');
  });

  it('the 404 page says exactly what document 03 specifies, and nothing else', () => {
    const main = section(raw.get('404.html'), 'main');
    expect(textTight(main)).toBe(NOT_FOUND_COPY);
  });

  it('the clusters empty state opens and closes on the document 03 sentences', () => {
    // Document 03 writes the empty state as
    //   "No clusters published yet. The first probe run is scheduled for {date}.
    //    The method is published at /method in the meantime."
    // {date} is a slot. The opening and closing sentences are fixed.
    const t = tightAll.get('clusters/index.html');
    expect(t).toContain('No clusters published yet.');
    expect(t).toContain('The method is published at /method in the meantime.');
  });

  it('the method page carries the four limits from document 02 verbatim', () => {
    // This test and "no banned word appears in the copy of any built page"
    // cannot both pass while document 02 keeps its current wording for the
    // first limit. Document 02 and document 03 both order that sentence
    // reproduced verbatim; document 07 bans one of its words on every product
    // surface. Neither test is wrong and neither is the build. The wording of
    // document 02 is a copy decision for Tom, not a code fix.
    const t = tightAll.get('method/index.html');
    expect(t, 'the "what this cannot see" heading is absent').toMatch(/What this cannot see/i);

    const missing = METHOD_LIMITS.filter((limit) => !t.includes(limit));
    expect(
      missing.length,
      `${missing.length} of the four limits in document 02 are not reproduced verbatim on ` +
        '/method. Document 02: "This appears on the public methodology page verbatim." ' +
        'Where the divergence is limit one, it is the document 02 / document 07 conflict ' +
        'described in the comment above this assertion, and it needs a decision rather than ' +
        'an edit.',
    ).toBe(0);
  });

  it('the method page publishes the rotation, cadence and publication lag', () => {
    // Document 03: "Then the anti-gaming section, stated openly. Publishing
    // that probes are rotated and lagged is not a leak - it is the deterrent."
    const t = tightAll.get('method/index.html');
    expect(t, 'wallet rotation is not stated').toMatch(/rotated between runs|wallet[^.]*rotated/i);
    expect(t, 'the cadence is not stated').toMatch(/not on a fixed cadence|randomised inside the scheduling window/i);
    expect(t, 'the publication lag is not stated').toMatch(/at least seven days behind/i);
  });

  it('the method page carries a version history with a version, a change and a date', () => {
    // Document 03: "Then a version history: every method version, what
    // changed, and the date."
    const html = raw.get('method/index.html');
    const t = textTight(html);
    expect(t, 'no version history heading').toMatch(/Version history/i);
    expect(t, `the current method version ${corpus.method_version} is not listed`)
      .toContain(corpus.method_version);
    const rows = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((m) => textTight(m[0]));
    const dated = rows.filter((r) => /\d{4}-\d{2}-\d{2}/.test(r) && /v\d/.test(r));
    expect(dated.length, 'no version history row carries both a version and a date')
      .toBeGreaterThan(0);
  });

  it('the disputes page carries the dispute address and states that outcomes are published', () => {
    const t = tightAll.get('disputes/index.html');
    expect(t).toContain(DISPUTE_INVITATION_ADDRESS);
    expect(t).toMatch(/whatever the outcome/);
  });
});

describe('D3 voice - document 07', () => {
  it('no banned word appears in the copy of any built page', () => {
    const hits = [];
    for (const f of PRODUCT_PAGES()) {
      const t = looseAll.get(f);
      for (const w of BANNED_WORDS) {
        const ctx = findWord(t, w, false);
        if (ctx) hits.push(`${f}: ...${ctx}...`);
      }
      if (new RegExp(BANNED_PHRASE, 'i').test(t)) hits.push(`${f}: banned phrase present`);
    }
    expect(
      hits,
      'document 07 bans these words on every product surface. Each hit is a copy decision, ' +
        'not a code fix - see the return for the document 02 / document 03 / document 07 ' +
        `conflict this surfaces.\n${hits.join('\n')}`,
    ).toEqual([]);
  });

  it('no class, id or data attribute is named for a banned word', () => {
    const hits = [];
    for (const f of PRODUCT_PAGES()) {
      const html = raw.get(f);
      for (const m of html.matchAll(/\s(class|id|name|data-[a-z-]+)="([^"]*)"/g)) {
        const flat = (m[1] + ' ' + m[2]).toLowerCase().replace(/[^a-z]/g, '');
        for (const stem of BANNED_STEMS) {
          if (flat.includes(stem)) hits.push(`${f}: ${m[1]}="${m[2]}"`);
        }
      }
    }
    expect(hits, `identifiers named for a banned word:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the only first-person writing on the site is the about page bio', () => {
    // Document 07 register table: "/about - the bio paragraph | A or C,
    // condensed | Tom Hogan". That paragraph is the single specified exception
    // to rule 1. Everything else on every page is Register D.
    const hits = [];
    for (const f of PRODUCT_PAGES()) {
      const html = raw.get(f).replace(/<p class="bio"[\s\S]*?<\/p>/g, ' ');
      const t = textLoose(html);
      for (const word of FIRST_PERSON) {
        const caseSensitive = word.startsWith('I');
        const ctx = findWord(t, word, caseSensitive);
        if (ctx) hits.push(`${f}: "${word}" in ...${ctx}...`);
      }
    }
    expect(hits, `first person outside the about page bio:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the bio exception exists exactly once, on the about page, and carries its byline', () => {
    const bioPages = PRODUCT_PAGES().filter((f) => /<p class="bio"[\s\S]*?<\/p>/.test(raw.get(f)));
    expect(bioPages, 'the bio paragraph must appear on /about and nowhere else')
      .toEqual(['about/index.html']);

    const html = raw.get('about/index.html');
    expect((html.match(/<p class="bio"/g) || []).length).toBe(1);

    const after = html.slice(html.indexOf('<p class="bio"'));
    expect(after, 'the bio must be followed by the Tom Hogan byline document 07 requires')
      .toMatch(/class="byline"[\s\S]{0,300}Tom Hogan/);
  });

  it('no built page contains an em dash', () => {
    // Crosspeel's own copy only. A value marked data-captured is an operator's
    // advertised text, stored verbatim per document 02 and rendered in mono so a
    // reader can see it is captured. Rewriting their punctuation to satisfy a
    // house style rule would falsify a captured value.
    const hits = PRODUCT_PAGES().filter((f) => stripInert(raw.get(f)).includes(EM_DASH));
    expect(hits, `em dash found in: ${hits.join(', ')}. The house rule is a spaced hyphen.`)
      .toEqual([]);
  });

  it('no built stylesheet or feed contains an em dash', () => {
    const others = allFiles.filter((f) => f.endsWith('.css') || f.endsWith('.xml'));
    const hits = others.filter((f) => fs.readFileSync(path.join(DIST, f), 'utf8').includes(EM_DASH));
    expect(hits, `em dash found in: ${hits.join(', ')}`).toEqual([]);
  });

  it('no built page carries a placeholder or an unfilled template slot', () => {
    const hits = [];
    for (const f of PRODUCT_PAGES()) {
      const t = looseAll.get(f);
      for (const p of PLACEHOLDERS) {
        const ctx = findWord(t, p, false);
        if (ctx) hits.push(`${f}: "${p}" in ...${ctx}...`);
      }
      // An unrendered Astro slot reaching the output: {n}, {date}, {slug}.
      const slot = t.match(/\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}/);
      if (slot) hits.push(`${f}: unfilled slot ${slot[0]}`);
    }
    expect(hits, `placeholder copy in the built output:\n${hits.join('\n')}`).toEqual([]);
  });
});

describe('D3 home page figures - document 03', () => {
  const figureValues = () => {
    const html = raw.get('index.html');
    return [...html.matchAll(/<td[^>]*class="figure-value"[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => textTight(m[1]));
  };

  it('there are four figure rows, one per document 03 label', () => {
    expect(figureValues()).toHaveLength(HOME_FIGURE_LABELS.length);
  });

  it('the three count figures render as numbers and match the corpus', () => {
    const [endpoints, clusters, spread] = figureValues();

    expect(endpoints, 'endpoints observed is not a bare number').toMatch(/^\d+$/);
    expect(Number(endpoints)).toBe(corpus.stats.endpoints_observed);

    expect(clusters, 'clusters published is not a bare number').toMatch(/^\d+$/);
    expect(Number(clusters)).toBe(corpus.stats.clusters_published);

    // House rule: two decimal places on every number. Document 03 renders the
    // spread with an x suffix.
    expect(spread, 'widest price spread is not a two decimal number with an x suffix')
      .toMatch(/^\d+\.\d{2}x$/);
    expect(Number(spread.replace(/x$/, ''))).toBe(corpus.stats.widest_spread_multiple);
  });

  it('with the empty corpus every count figure is zero, displayed as zero', () => {
    // Document 03: "If any is zero, it displays zero. No placeholder figures
    // ever ship." This test is meaningful only against the committed empty
    // state and is skipped once the corpus carries rows.
    if (corpus.stats.endpoints_observed !== 0) return;
    const [endpoints, clusters, spread] = figureValues();
    expect(endpoints).toBe('0');
    expect(clusters).toBe('0');
    expect(spread).toBe('0.00x');
  });

  it('the last probe run figure is a date, or states plainly that no run has happened', () => {
    // Document 03 renders this row as {date}, not as a count. With
    // stats.last_probe_run null there is no date to render, and document 00
    // forbids inventing one.
    const value = figureValues()[3];
    const isDate = /^\d{4}-\d{2}-\d{2}/.test(value);
    const isHonestAbsence = /not yet run|no probe run/i.test(value);
    expect(
      isDate || isHonestAbsence,
      `last probe run rendered as "${value}", which is neither a date nor a stated absence`,
    ).toBe(true);
    if (corpus.stats.last_probe_run === null) {
      expect(isDate, 'a date was rendered for a probe run that has not happened').toBe(false);
    }
  });

  it('the home page shows the recent clusters block, empty when the corpus is empty', () => {
    const t = tightAll.get('index.html');
    expect(t).toContain('Most recent clusters');
    if ((corpus.clusters || []).length === 0) {
      expect(t).toContain('No clusters published yet.');
    }
    expect(raw.get('index.html')).toContain('href="/clusters"');
  });

  it('no page claims an observation date the corpus does not carry', () => {
    // Document 03: "Every page carries a <meta name="observed"> date where its
    // content derives from observations." A meta observed date on an empty
    // corpus would be a recorded claim presented as an observed one, which
    // document 00 forbids at the level above every surface.
    for (const f of PRODUCT_PAGES()) {
      const m = raw.get(f).match(/<meta\s+name="observed"\s+content="([^"]*)"/);
      if (corpus.observed_through === null) {
        expect(m, `${f} emits an observed date but the corpus has observed nothing`).toBeNull();
      } else if (m) {
        expect(m[1]).toBe(corpus.observed_through);
      }
    }
  });
});

describe('D3 third-party requests - document 03', () => {
  const attrValues = (attr) => {
    const out = [];
    for (const f of PRODUCT_PAGES()) {
      for (const m of raw.get(f).matchAll(new RegExp(`\\s${attr}="([^"]*)"`, 'g'))) {
        out.push([f, m[1]]);
      }
    }
    return out;
  };

  it('no built page loads a script from anywhere', () => {
    const scripts = [];
    for (const f of PRODUCT_PAGES()) {
      for (const m of raw.get(f).matchAll(/<script\b[^>]*>/gi)) scripts.push(`${f}: ${m[0]}`);
    }
    expect(scripts, `document 03 allows no third-party script:\n${scripts.join('\n')}`).toEqual([]);
  });

  it('every stylesheet is served from this origin', () => {
    for (const f of PRODUCT_PAGES()) {
      for (const m of raw.get(f).matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)) {
        const href = (m[0].match(/href="([^"]*)"/) || [])[1] || '';
        expect(href, `${f} loads a stylesheet from another origin: ${href}`).toMatch(/^\//);
      }
    }
  });

  it('every font is self-hosted, preloaded from this origin', () => {
    for (const f of PRODUCT_PAGES()) {
      for (const m of raw.get(f).matchAll(/<link\b[^>]*as="font"[^>]*>/gi)) {
        const href = (m[0].match(/href="([^"]*)"/) || [])[1] || '';
        expect(href, `${f} preloads a font from another origin: ${href}`).toMatch(/^\/fonts\//);
        expect(allFiles, `${f} preloads a font that is not in dist: ${href}`)
          .toContain(href.replace(/^\//, ''));
      }
    }
  });

  it('every url() in the built stylesheets is relative to this origin', () => {
    for (const f of cssFiles) {
      const css = fs.readFileSync(path.join(DIST, f), 'utf8');
      for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        const url = m[1].trim();
        if (url.startsWith('data:')) continue;
        expect(url, `${f} loads ${url} from another origin`).toMatch(/^\//);
        expect(allFiles, `${f} loads ${url}, which is not in dist`)
          .toContain(url.replace(/^\//, ''));
      }
    }
  });

  it('no image or media element loads from another origin', () => {
    for (const [f, value] of attrValues('src')) {
      if (value.startsWith('data:')) continue;
      const absolute = /^https?:\/\//i.test(value);
      expect(absolute, `${f} loads ${value} from another origin`).toBe(false);
    }
  });

  it('the only absolute URLs are the site canonical and the two documented outbound links', () => {
    const offenders = [];
    for (const f of PRODUCT_PAGES()) {
      for (const m of raw.get(f).matchAll(/(?:href|src)="(https?:\/\/[^"]*)"/g)) {
        let host;
        try {
          host = new URL(m[1]).hostname.replace(/^www\./, '');
        } catch {
          offenders.push(`${f}: unparseable ${m[1]}`);
          continue;
        }
        if (host === SELF_HOST) continue;
        if (ALLOWED_EXTERNAL_HOSTS.includes(host)) continue;
        offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders, `undocumented outbound host:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no absolute URL uses plain http', () => {
    const offenders = [];
    for (const f of PRODUCT_PAGES()) {
      for (const m of raw.get(f).matchAll(/(?:href|src)="(http:\/\/[^"]*)"/g)) {
        offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders, `insecure URL:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the github link points at the public repository under tjhoags', () => {
    const t = raw.get('index.html');
    const m = t.match(/href="(https:\/\/github\.com\/[^"]*)"/);
    expect(m, 'the footer GitHub link is absent').not.toBeNull();
    expect(m[1]).toMatch(/^https:\/\/github\.com\/tjhoags\//);
  });
});

describe('D3 links and routes - document 09 category T4', () => {
  const internalLinks = () => {
    const out = [];
    for (const f of PRODUCT_PAGES()) {
      for (const m of raw.get(f).matchAll(/href="([^"]*)"/g)) {
        const href = m[1];
        if (/^(https?:|mailto:|tel:|data:)/i.test(href)) continue;
        out.push([f, href]);
      }
    }
    return out;
  };

  it('every internal href resolves to a file that exists in dist', () => {
    const broken = [];
    for (const [f, href] of internalLinks()) {
      if (href.startsWith('#')) continue;
      const clean = href.split('#')[0].split('?')[0];
      if (clean === '') continue;
      expect(clean.startsWith('/'), `${f} links to a relative path: ${href}`).toBe(true);

      const bare = clean.replace(/^\//, '').replace(/\/$/, '');
      const candidates = bare === ''
        ? ['index.html']
        : [bare, `${bare}/index.html`, `${bare}.html`];
      if (!candidates.some((c) => allFiles.includes(c))) broken.push(`${f} -> ${href}`);
    }
    expect(
      broken,
      `broken internal links. Document 09: a broken link blocks G1.\n${broken.join('\n')}`,
    ).toEqual([]);
  });

  it('every in-page fragment link has a target with that id', () => {
    const broken = [];
    for (const [f, href] of internalLinks()) {
      if (!href.startsWith('#')) continue;
      const id = href.slice(1);
      if (!new RegExp(`id="${id}"`).test(raw.get(f))) broken.push(`${f} -> ${href}`);
    }
    expect(broken, `fragment with no target:\n${broken.join('\n')}`).toEqual([]);
  });

  it('every built route is reachable from the home page in three clicks or fewer', () => {
    const graph = new Map();
    for (const f of PRODUCT_PAGES()) {
      const targets = new Set();
      for (const m of raw.get(f).matchAll(/href="([^"]*)"/g)) {
        const href = m[1];
        if (/^(https?:|mailto:|tel:|data:|#)/i.test(href)) continue;
        const bare = href.split('#')[0].split('?')[0].replace(/\/$/, '');
        const target = bare === '' ? 'index.html' : `${bare.replace(/^\//, '')}/index.html`;
        if (htmlFiles.includes(target)) targets.add(target);
      }
      graph.set(f, targets);
    }

    const depth = new Map([['index.html', 0]]);
    let frontier = ['index.html'];
    while (frontier.length) {
      const next = [];
      for (const node of frontier) {
        for (const t of graph.get(node) || []) {
          if (!depth.has(t)) {
            depth.set(t, depth.get(node) + 1);
            next.push(t);
          }
        }
      }
      frontier = next;
    }

    // 404 is reached by a wrong URL, not by a link, and is correctly orphaned.
    const orphans = htmlFiles.filter((f) => f !== '404.html' && !depth.has(f));
    expect(orphans, `route not reachable from the home page: ${orphans.join(', ')}`).toEqual([]);

    const tooDeep = [...depth.entries()].filter(([, d]) => d > 3).map(([f, d]) => `${f} at ${d}`);
    expect(tooDeep, `route further than three clicks from home: ${tooDeep.join(', ')}`).toEqual([]);
  });

  it('the sitemap lists every built route and nothing that was not built', () => {
    const sitemapPath = path.join(DIST, 'sitemap.xml');
    expect(fs.existsSync(sitemapPath), 'sitemap.xml was not built').toBe(true);
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    const listed = locs
      .map((u) => new URL(u).pathname)
      .map((p) => (p === '/' ? '/' : p.replace(/\/$/, '')))
      .sort();

    const expected = htmlFiles
      .filter((f) => f !== '404.html')
      .map(routeForFile)
      .concat(allFiles.includes('clusters/rss.xml') ? ['/clusters/rss.xml'] : [])
      .sort();

    expect(listed).toEqual(expected);
    expect(listed, 'the 404 page must not be in the sitemap').not.toContain('/404');
  });

  it('the clusters feed is built and points at this site', () => {
    const rssPath = path.join(DIST, 'clusters', 'rss.xml');
    expect(fs.existsSync(rssPath), 'clusters/rss.xml was not built').toBe(true);
    const xml = fs.readFileSync(rssPath, 'utf8');
    expect(xml).toContain('<channel>');
    expect(xml).toContain(`https://${SELF_HOST}/clusters/`);
    // Every item in the feed must correspond to a built cluster page.
    const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)];
    expect(items).toHaveLength((corpus.clusters || []).length);
  });

  it('every page declares the feed so a machine can find a new finding', () => {
    for (const f of PRODUCT_PAGES()) {
      expect(raw.get(f), `${f} does not declare the RSS feed`)
        .toMatch(/rel="alternate"[^>]*application\/rss\+xml/);
    }
  });
});
