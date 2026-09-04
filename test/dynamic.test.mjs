/* Independent verification of runbook step D4 - the pre-rendered cluster and
 * endpoint pages, the sitemap, and the cluster feed.
 *
 * These tests were written by a sub-agent that did not write the pages, from
 * documents 02, 03 and 09 and the data contract in src/data/README.md only, per
 * the separation rule in document 09.
 *
 * How they run. The site is built three times into scratch trees from fixture
 * corpora written here: one populated, one empty with a scheduled run, one empty
 * with none. The repository's own src/data/corpus.json is never written to - a
 * second agent may be working in this tree, and a test that alters the tree it
 * is testing proves nothing about the tree that ships.
 *
 * Root override. CROSSPEEL_SITE_ROOT points the suite at a different tree. It
 * exists so every assertion below can be observed failing against a deliberately
 * altered site before it is run against the real one - the failing-first rule in
 * document 09. It defaults to this repository and nothing in the build reads it.
 *
 * Category mapping, document 09:
 *   T1 unit     the one sentence claim, the arithmetic behind it, the empty state
 *   T3 path     corpus.json -> astro build -> dist, rendered and read back
 *   T4 link     evidence permalinks resolve to an artifact whose sha-256 matches,
 *               the sitemap holds every published route and no withheld one, the
 *               feed is well formed and its items match the published clusters
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CROSSPEEL_SITE_ROOT
  ? path.resolve(process.env.CROSSPEEL_SITE_ROOT)
  : path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const ASTRO_BIN = path.join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crosspeel-d4-site-'));
const EVIDENCE_BASE = 'https://crosspeel.com/evidence/';
const ORIGIN = 'https://crosspeel.com';

/* ------------------------------------------------------------------ *
 * The fixture corpus, written to the contract in src/data/README.md
 * ------------------------------------------------------------------ */

const ARTIFACTS = path.join(TMP, 'artifacts');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Writes an artifact into the fixture store and returns an evidence row. */
function storeEvidence({ observationId, endpointId, observedAt, statusCode = 200, store = true }) {
  const body = JSON.stringify({ symbol: 'TEST', bid: 1.234567, ask: 1.234571, at: observedAt });
  const headers = JSON.stringify({ server: 'nginx', 'content-type': 'application/json' });
  const bodyKey = `raw/${endpointId}/${observedAt}/${observationId}.body`;
  const headersKey = `raw/${endpointId}/${observedAt}/${observationId}.headers.json`;
  if (store) {
    for (const [key, text] of [[bodyKey, body], [headersKey, headers]]) {
      const file = path.join(ARTIFACTS, key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, 'utf8');
    }
  }
  return {
    observation_id: observationId,
    endpoint_id: endpointId,
    observed_at: observedAt,
    status_code: statusCode,
    body_sha256: sha256(body),
    r2_body_key: bodyKey,
    r2_headers_key: headersKey,
    permalink: EVIDENCE_BASE + bodyKey,
    headers_permalink: EVIDENCE_BASE + headersKey,
  };
}

const ALPHA = { id: 'ep-000000000001', slug: 'alpha-example-test', hostname: 'alpha.example.test', price: 0.05 };
const BETA = { id: 'ep-000000000002', slug: 'beta-example-test', hostname: 'beta.example.test', price: 0.21 };
const SOLO = { id: 'ep-000000000004', slug: 'solo-example-test', hostname: 'solo.example.test', price: 0.09 };

// A cluster the exporter withheld. It is carried in the fixture under a key the
// contract does not define, because the site must take its routes from
// corpus.clusters and from nothing else. Every token here must reach neither the
// sitemap, nor the feed, nor any built page.
const WITHHELD = {
  slug: 'market-data-02',
  id: 'cl-000000000002',
  hostname: 'omega.example.test',
  operator_name: 'Omega Signals Incorporated',
};

const CLUSTER_SLUG = 'market-data-01';

const clusterEvidence = [
  storeEvidence({ observationId: 'ob-alpha-0001', endpointId: ALPHA.id, observedAt: '2026-08-20T09:00:00Z' }),
  storeEvidence({ observationId: 'ob-beta-0001', endpointId: BETA.id, observedAt: '2026-08-20T09:05:00Z' }),
  storeEvidence({ observationId: 'ob-alpha-0002', endpointId: ALPHA.id, observedAt: '2026-08-22T09:00:00Z' }),
  storeEvidence({ observationId: 'ob-beta-0002', endpointId: BETA.id, observedAt: '2026-08-22T09:05:00Z' }),
];
const soloEvidence = [
  storeEvidence({ observationId: 'ob-solo-0001', endpointId: SOLO.id, observedAt: '2026-08-22T09:10:00Z' }),
];

const FIELDS = [
  ['error_string', 'invalid symbol: expected 1-5 uppercase characters, received ""', true],
  ['key_order_hash', 'a3f1c0d2e5b6a798', true],
  ['field_paths_hash', 'bb02c1d3e6b7a809', true],
  ['header_order', '["date","content-type","server"]', true],
  ['server_header', 'nginx', true],
  ['tls_issuer', 'CN=E5,O=Test Encrypt,C=US', true],
  ['timestamp_format', 'iso8601-utc-seconds', true],
  ['float_precision_max', 6, true],
  ['null_vs_omitted', '["bid_size"]', true],
  ['status_code', 200, false],
];

function member(ep, multipleVsMin) {
  return {
    endpoint_id: ep.id,
    slug: ep.slug,
    hostname: ep.hostname,
    url: `https://${ep.hostname}/v1/quote`,
    operator_name: ep.hostname === ALPHA.hostname ? 'Alpha Data Company' : 'Beta Feeds Limited',
    capability: 'market data',
    price_usd: ep.price,
    multiple_vs_min: multipleVsMin,
    observed_at: '2026-08-22T09:00:00Z',
    provenance: 'observed',
  };
}

const CLUSTER = {
  id: 'cl-000000000001',
  slug: CLUSTER_SLUG,
  capability: 'market data',
  confidence: 'high',
  method_version: 'v1',
  matched_fields: 41,
  compared_fields: 43,
  paired_obs_count: 33,
  min_price_usd: ALPHA.price,
  max_price_usd: BETA.price,
  spread_multiple: 4.2,
  member_count: 2,
  first_published: '2026-08-28T00:00:00Z',
  last_updated: '2026-08-29T00:00:00Z',
  members: [member(ALPHA, 1), member(BETA, 4.2)],
  fields: FIELDS.map(([field, value, discriminating]) => ({
    field,
    values: { [ALPHA.id]: value, [BETA.id]: value },
    identical: true,
    discriminating,
  })).concat([
    {
      field: 'pay_amount_usd',
      values: { [ALPHA.id]: ALPHA.price, [BETA.id]: BETA.price },
      identical: false,
      discriminating: false,
    },
  ]),
  evidence: clusterEvidence,
  observation_window: { from: '2026-08-20T09:00:00Z', to: '2026-08-22T09:05:00Z', distinct_inputs: 3 },
  disputes: [
    {
      id: 'dp-0001',
      received_at: '2026-08-30T11:00:00Z',
      claimant: 'Alpha Data Company',
      claim: 'The two endpoints run on a shared open source template and are operated separately.',
      response: 'The finding states field agreement and price. It is published unchanged alongside this dispute.',
      outcome: 'open',
    },
  ],
};

function endpointRow(ep, evidence, clusterSlug) {
  return {
    id: ep.id,
    slug: ep.slug,
    url: `https://${ep.hostname}/v1/quote`,
    hostname: ep.hostname,
    operator_name: ep.hostname === SOLO.hostname ? 'Solo Metrics' : 'Alpha Data Company',
    capability: 'market data',
    tag: 'market-data',
    source_directory: 'https://directory.example.test/list',
    first_seen: '2026-08-18T00:00:00Z',
    last_seen: '2026-08-22T00:00:00Z',
    status: 'active',
    cluster_slug: clusterSlug,
    latest_observed_price: { amount_usd: ep.price, observed_at: '2026-08-22T09:00:00Z', provenance: 'observed' },
    observation_count: evidence.length,
    price_history: [
      { observed_at: '2026-08-19T00:00:00Z', amount_usd: 0.03, asset: 'USDC', raw_amount: '30000', provenance: 'recorded' },
      { observed_at: '2026-08-22T09:00:00Z', amount_usd: ep.price, asset: 'USDC', raw_amount: '50000', provenance: 'observed' },
    ],
    observations: evidence.map((e) => ({
      observation_id: e.observation_id,
      observed_at: e.observed_at,
      status_code: e.status_code,
      ttfb_ms: 118.46,
      total_ms: 204.99,
      cost_usd: ep.price,
      body_sha256: e.body_sha256,
      permalink: e.permalink,
      headers_permalink: e.headers_permalink,
    })),
  };
}

const POPULATED = {
  generated_at: '2026-09-04T12:00:00Z',
  observed_through: '2026-08-22T09:10:00Z',
  next_probe_run: null,
  stats: {
    endpoints_observed: 3,
    clusters_published: 1,
    widest_spread_multiple: 4.2,
    last_probe_run: '2026-08-22T03:41:00Z',
  },
  clusters: [CLUSTER],
  endpoints: [
    endpointRow(ALPHA, clusterEvidence.filter((e) => e.endpoint_id === ALPHA.id), CLUSTER_SLUG),
    endpointRow(BETA, clusterEvidence.filter((e) => e.endpoint_id === BETA.id), CLUSTER_SLUG),
    endpointRow(SOLO, soloEvidence, null),
  ],
  disputes: CLUSTER.disputes.map((d) => ({ ...d, cluster_slug: CLUSTER_SLUG })),
  featured_diff: {
    cluster_slug: CLUSTER_SLUG,
    cluster_url: `/clusters/${CLUSTER_SLUG}/`,
    capability: 'market data',
    member_count: 2,
    matched_fields: 41,
    compared_fields: 43,
    spread_multiple: 4.2,
    observed_at: '2026-08-22T09:05:00Z',
    left: CLUSTER.members[0],
    right: CLUSTER.members[1],
    fields: CLUSTER.fields.map((f) => ({
      field: f.field,
      left: f.values[ALPHA.id],
      right: f.values[BETA.id],
      identical: f.identical,
    })),
  },
  method_version: 'v1',
  bakeoff: {
    variants: [
      { variant: 'A', price_usd: 6.0 },
      { variant: 'B', price_usd: 11.0 },
      { variant: 'C', price_usd: 19.0 },
    ],
    inputs_per_endpoint: 8,
    min_endpoints: 2,
    max_endpoints: 8,
  },
  // Not part of the contract. Present so that a page reading anything other than
  // corpus.clusters is visible rather than silent.
  withheld_for_this_test: [WITHHELD],
};

function emptyCorpus(nextProbeRun) {
  return {
    generated_at: '2026-09-04T12:00:00Z',
    observed_through: null,
    next_probe_run: nextProbeRun,
    stats: { endpoints_observed: 0, clusters_published: 0, widest_spread_multiple: 0, last_probe_run: null },
    clusters: [],
    endpoints: [],
    disputes: [],
    featured_diff: null,
    method_version: 'v1',
    bakeoff: POPULATED.bakeoff,
  };
}

/* ------------------------------------------------------------------ *
 * Building
 * ------------------------------------------------------------------ */

function readTree(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readTree(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

const TEXT_EXT = new Set(['.html', '.xml', '.js', '.css', '.json', '.txt', '.svg', '.map']);

function buildSite(corpus, name) {
  if (!fs.existsSync(ASTRO_BIN)) {
    throw new Error(`astro is not installed at ${ASTRO_BIN}. The built pages cannot be verified without it.`);
  }
  const root = path.join(TMP, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const entry of ['src', 'public', 'astro.config.mjs', 'package.json']) {
    fs.cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(root, 'src', 'data', 'corpus.json'), JSON.stringify(corpus, null, 2) + '\n', 'utf8');

  execFileSync(process.execPath, [ASTRO_BIN, 'build'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const dist = path.join(root, 'dist');
  const files = readTree(dist);
  return {
    dist,
    files,
    text: files
      .filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()))
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n'),
    read: (rel) => fs.readFileSync(path.join(dist, rel), 'utf8'),
    has: (rel) => fs.existsSync(path.join(dist, rel)),
  };
}

const site = buildSite(POPULATED, 'populated');
const emptyScheduled = buildSite(emptyCorpus('2026-09-18T03:00:00Z'), 'empty-scheduled');
const emptyUnscheduled = buildSite(emptyCorpus(null), 'empty-unscheduled');

const clusterHtml = site.read(path.join('clusters', CLUSTER_SLUG, 'index.html'));
// Every ordering assertion runs over the body. The head carries the title and
// the description, which repeat page text and would make an order test pass for
// the wrong reason.
const clusterBody = clusterHtml.slice(clusterHtml.indexOf('<body'));

/* ------------------------------------------------------------------ *
 * A minimal XML well formedness check
 * ------------------------------------------------------------------ */

function assertWellFormedXml(xml, label) {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), `${label} has no XML declaration`).toBe(true);

  // Raw ampersands that begin no entity are the usual way a hand built feed
  // stops parsing.
  const stray = [...xml.matchAll(/&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g)];
  expect(stray.length, `${label} carries ${stray.length} unescaped ampersands`).toBe(0);

  const stack = [];
  const roots = [];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let consumed = 0;
  let m;
  while ((m = tag.exec(xml)) !== null) {
    const [full, closing, name, , selfClosing] = m;
    consumed += full.length;
    if (closing) {
      expect(stack.pop(), `${label} closes ${name} out of order`).toBe(name);
      if (stack.length === 0) roots.push(name);
    } else if (selfClosing) {
      if (stack.length === 0) roots.push(name);
    } else {
      stack.push(name);
    }
  }
  expect(stack, `${label} leaves tags open: ${stack.join(', ')}`).toEqual([]);
  expect(roots.length, `${label} has ${roots.length} root elements`).toBe(1);

  // Every angle bracket in the document belongs to a tag, a declaration or a
  // comment. Anything left over is text that was never escaped.
  const leftovers = xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(tag, '');
  expect(leftovers.includes('<'), `${label} carries an unescaped angle bracket`).toBe(false);
  expect(consumed).toBeGreaterThan(0);
}

/* ------------------------------------------------------------------ *
 * Document 03 - the cluster page, section by section, in order
 * ------------------------------------------------------------------ */

describe('a cluster page renders every section from document 03 in order', () => {
  // Document 03, /clusters/{slug}: title, the claim in one sentence, any dispute
  // notice, the diff pane, the price table, the paired observation record, the
  // evidence blocks, method and confidence, the dispute invitation.
  const SECTIONS = [
    ['title', `Cluster ${CLUSTER_SLUG} - market data`],
    ['claim', 'compared fields.'],
    ['dispute notice', 'aria-label="Dispute notice"'],
    ['diff pane', 'Captured fields'],
    ['price table', 'Prices observed'],
    ['paired observation record', 'Paired observation record'],
    ['evidence blocks', '>Evidence<'],
    ['method and confidence', 'Method and confidence'],
    ['dispute invitation', 'Dispute this finding'],
  ];

  it('every section is present', () => {
    for (const [name, marker] of SECTIONS) {
      expect(clusterBody.includes(marker), `the page has no ${name}`).toBe(true);
    }
  });

  it('the sections appear in the documented order', () => {
    const positions = SECTIONS.map(([name, marker]) => [name, clusterBody.indexOf(marker)]);
    for (let i = 1; i < positions.length; i += 1) {
      expect(
        positions[i][1],
        `${positions[i][0]} at ${positions[i][1]} is not after ${positions[i - 1][0]} at ${positions[i - 1][1]}`
      ).toBeGreaterThan(positions[i - 1][1]);
    }
  });

  it('the dispute notice is above the evidence, never below it', () => {
    const notice = clusterBody.indexOf('aria-label="Dispute notice"');
    const evidence = clusterBody.indexOf('>Evidence<');
    expect(notice).toBeGreaterThan(-1);
    expect(evidence).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(evidence);
  });

  it('the dispute notice is above the finding it concerns', () => {
    expect(clusterBody.indexOf('aria-label="Dispute notice"')).toBeLessThan(clusterBody.indexOf('Captured fields'));
  });

  it('the dispute is published with its claim and its outcome, whatever the outcome', () => {
    expect(clusterBody).toContain(CLUSTER.disputes[0].claim);
    expect(clusterBody).toContain('Alpha Data Company');
    expect(clusterBody.toLowerCase()).toContain('open');
  });

  it('the fixed dispute invitation from document 03 is reproduced verbatim', () => {
    const invitation =
      'If you operate one of these endpoints and believe this finding is wrong, write to disputes@crosspeel.com ' +
      'with the endpoint URL and what you believe is inaccurate. Disputes are published on this page alongside the ' +
      'finding, whatever the outcome.';
    expect(clusterBody.replace(/\s+/g, ' ')).toContain(invitation);
  });

  it('the page carries the observation date it rests on', () => {
    expect(clusterHtml).toContain('<meta name="observed" content="2026-08-22T09:05:00Z">');
  });
});

/* ------------------------------------------------------------------ *
 * The one sentence claim
 * ------------------------------------------------------------------ */

describe('the one sentence claim states field agreement and price, and nothing else', () => {
  const CLAIM = /(\d+) endpoints returned identical responses across (\d+) of (\d+) compared fields\. Observed prices range from \$([\d.]+) to \$([\d.]+), a spread of (\d+\.\d{2})x\./;

  it('matches the sentence document 03 specifies', () => {
    const found = clusterBody.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').match(CLAIM);
    expect(found, 'the documented claim sentence is not on the page').not.toBeNull();
    expect(found[1]).toBe(String(CLUSTER.member_count));
    expect(found[2]).toBe(String(CLUSTER.matched_fields));
    expect(found[3]).toBe(String(CLUSTER.compared_fields));
    expect(found[4]).toBe('0.05');
    expect(found[5]).toBe('0.21');
    expect(found[6]).toBe('4.20');
  });

  it('the spread it states equals max price over min price, computed here from the member rows', () => {
    const prices = CLUSTER.members.map((m) => m.price_usd);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const spread = Math.round((max / min) * 100) / 100;
    expect(spread.toFixed(2)).toBe('4.20');

    const found = clusterBody.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').match(CLAIM);
    expect(found[6]).toBe(spread.toFixed(2));
    expect(Number(found[4])).toBe(min);
    expect(Number(found[5])).toBe(max);
  });

  it('the price table states the same multiple to two decimal places', () => {
    const text = clusterBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('4.20x');
    expect(text).toContain('1.00x');
  });

  it('the claim asserts no relationship between the operators', () => {
    const claimText = clusterBody.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').match(CLAIM)[0];
    const relational = [
      'owned', 'owns', 'ownership', 'affiliate', 'affiliated', 'subsidiary', 'parent company',
      'same operator', 'same owner', 'related to', 'front for', 'controlled by', 'resold', 'resells',
    ];
    for (const word of relational) {
      expect(new RegExp(`\\b${word}\\b`, 'i').test(claimText), `the claim says "${word}"`).toBe(false);
    }
  });

  it('no accusatory word from document 07 appears on the cluster page', () => {
    // Assembled from fragments. The literals do not belong in a public file, and
    // a test file carrying them would match its own scan.
    const banned = [
      'resell' + 'er', 'resell' + 'ers', 'wrap' + 'per', 'fak' + 'e', 'sca' + 'm', 'rip-' + 'off',
      'middle' + 'man', 'goug' + 'ing', 'decept' + 'ive', 'mislead' + 'ing', 'expos' + 'ed',
      'hid' + 'den', 'sec' + 'ret', 'cau' + 'ght', 'the same ' + 'company',
    ];
    const text = clusterBody.replace(/<[^>]+>/g, ' ');
    for (const word of banned) {
      expect(new RegExp(`\\b${word}\\b`, 'i').test(text), `the cluster page contains "${word}"`).toBe(false);
    }
  });

  it('no accusatory word appears anywhere in the built site', () => {
    const banned = [
      'resell' + 'er', 'wrap' + 'per', 'sca' + 'm', 'rip-' + 'off', 'middle' + 'man',
      'goug' + 'ing', 'decept' + 'ive', 'mislead' + 'ing', 'the same ' + 'company',
    ];
    for (const word of banned) {
      expect(new RegExp(`\\b${word}\\b`, 'i').test(site.text), `the built site contains "${word}"`).toBe(false);
    }
  });

  it('the page carries no emoji and no em dash', () => {
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(clusterBody)).toBe(false);
    expect(clusterBody.includes('—')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * T4 - evidence
 * ------------------------------------------------------------------ */

describe('T4 every evidence permalink on the cluster page resolves', () => {
  const rendered = [...new Set([...clusterHtml.matchAll(/https:\/\/crosspeel\.com\/evidence\/[^"'<\s]+/g)].map((m) => m[0]))];

  it('the page carries a permalink for every stored response', () => {
    expect(rendered.length).toBeGreaterThan(0);
    for (const e of CLUSTER.evidence) {
      expect(rendered, `no permalink for ${e.observation_id}`).toContain(e.permalink);
    }
  });

  it('every rendered permalink names an artifact key that exists', () => {
    for (const url of rendered) {
      expect(url.startsWith(EVIDENCE_BASE)).toBe(true);
      const key = url.slice(EVIDENCE_BASE.length);
      expect(fs.existsSync(path.join(ARTIFACTS, key)), `no artifact stored at ${key}`).toBe(true);
    }
  });

  it('the body_sha256 shown beside each link matches the artifact it names', () => {
    for (const e of CLUSTER.evidence) {
      const key = e.permalink.slice(EVIDENCE_BASE.length);
      const bytes = fs.readFileSync(path.join(ARTIFACTS, key), 'utf8');
      expect(sha256(bytes)).toBe(e.body_sha256);
      expect(clusterHtml, `the page omits the hash for ${e.observation_id}`).toContain(e.body_sha256);
    }
  });

  it('the page invents no permalink of its own', () => {
    const known = new Set(CLUSTER.evidence.flatMap((e) => [e.permalink, e.headers_permalink]));
    for (const url of rendered) {
      expect(known.has(url), `the page links to ${url}, which is in no evidence row`).toBe(true);
    }
  });

  it('an endpoint page links to the same artifacts with the same hashes', () => {
    const html = site.read(path.join('endpoints', ALPHA.slug, 'index.html'));
    const own = CLUSTER.evidence.filter((e) => e.endpoint_id === ALPHA.id);
    expect(own.length).toBeGreaterThan(0);
    for (const e of own) {
      expect(html).toContain(e.permalink);
      expect(html).toContain(e.body_sha256);
      expect(fs.existsSync(path.join(ARTIFACTS, e.permalink.slice(EVIDENCE_BASE.length)))).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * T4 - the sitemap
 * ------------------------------------------------------------------ */

describe('T4 the sitemap holds every published route and no withheld one', () => {
  const sitemap = site.read('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it('is well formed XML', () => {
    assertWellFormedXml(sitemap, 'sitemap.xml');
  });

  it('holds every route in the document 03 information architecture', () => {
    for (const route of ['/', '/clusters/', '/endpoints/', '/method/', '/disputes/', '/bakeoff/', '/mcp/', '/about/']) {
      expect(locs, `the sitemap omits ${route}`).toContain(ORIGIN + route);
    }
    expect(locs).toContain(`${ORIGIN}/clusters/rss.xml`);
  });

  it('holds one entry per published cluster and one per exported endpoint', () => {
    for (const c of POPULATED.clusters) expect(locs).toContain(`${ORIGIN}/clusters/${c.slug}/`);
    for (const e of POPULATED.endpoints) expect(locs).toContain(`${ORIGIN}/endpoints/${e.slug}/`);
  });

  it('advertises no route that was not built', () => {
    for (const loc of locs) {
      const rel = loc.slice(ORIGIN.length);
      if (rel === '/clusters/rss.xml') {
        expect(site.has(path.join('clusters', 'rss.xml'))).toBe(true);
        continue;
      }
      const target = rel === '/' ? 'index.html' : path.join(rel.replace(/^\/|\/$/g, ''), 'index.html');
      expect(site.has(target), `the sitemap advertises ${loc}, which was never built`).toBe(true);
    }
  });

  it('carries no withheld cluster, and no 404', () => {
    expect(sitemap).not.toContain(WITHHELD.slug);
    expect(sitemap).not.toContain(WITHHELD.hostname);
    expect(locs.some((l) => l.includes('404'))).toBe(false);
  });

  it('every entry is unique', () => {
    expect(new Set(locs).size).toBe(locs.length);
  });
});

/* ------------------------------------------------------------------ *
 * T4 - the feed
 * ------------------------------------------------------------------ */

describe('T4 the cluster feed is valid XML and its items are the published clusters', () => {
  const rss = site.read(path.join('clusters', 'rss.xml'));

  it('is well formed XML with one channel', () => {
    assertWellFormedXml(rss, 'clusters/rss.xml');
    expect((rss.match(/<channel>/g) || []).length).toBe(1);
    expect(rss).toContain('<rss version="2.0"');
  });

  it('has exactly one item per published cluster', () => {
    const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    expect(items.length).toBe(POPULATED.clusters.length);
    const links = items.map((i) => i.match(/<link>([^<]+)<\/link>/)[1]);
    expect(links.sort()).toEqual(POPULATED.clusters.map((c) => `${ORIGIN}/clusters/${c.slug}/`).sort());
  });

  it('each item carries the same one sentence claim the cluster page carries', () => {
    const description = rss.match(/<item>[\s\S]*?<description>([\s\S]*?)<\/description>/)[1];
    expect(description).toContain('41 of 43 compared fields');
    expect(description).toContain('a spread of 4.20x');
    expect(description).toContain('$0.05');
    expect(description).toContain('$0.21');
  });

  it('every item guid is the permanent cluster URL', () => {
    for (const c of POPULATED.clusters) {
      expect(rss).toContain(`<guid isPermaLink="true">${ORIGIN}/clusters/${c.slug}/</guid>`);
    }
  });

  it('carries no withheld cluster', () => {
    expect(rss).not.toContain(WITHHELD.slug);
    expect(rss).not.toContain(WITHHELD.hostname);
  });
});

/* ------------------------------------------------------------------ *
 * Nothing outside corpus.clusters becomes a route
 * ------------------------------------------------------------------ */

describe('the site takes its routes from corpus.clusters and from nothing else', () => {
  it('builds one cluster directory per published cluster and no others', () => {
    const dirs = fs
      .readdirSync(path.join(site.dist, 'clusters'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(POPULATED.clusters.map((c) => c.slug).sort());
  });

  it('no token from a withheld cluster appears anywhere in dist', () => {
    for (const token of [WITHHELD.slug, WITHHELD.id, WITHHELD.hostname, WITHHELD.operator_name]) {
      expect(site.text.includes(token), `dist contains ${token}`).toBe(false);
    }
  });

  it('builds one endpoint directory per exported endpoint and no others', () => {
    const dirs = fs
      .readdirSync(path.join(site.dist, 'endpoints'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(POPULATED.endpoints.map((e) => e.slug).sort());
  });

  it('every internal link on the cluster page points at a route that was built', () => {
    const hrefs = [...new Set([...clusterBody.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]))];
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (/\.(xml|css|js|woff2?|svg|ico|png)$/.test(href)) {
        expect(site.has(href.replace(/^\//, '')), `${href} was not built`).toBe(true);
        continue;
      }
      const rel = href.replace(/^\/|\/$/g, '');
      const target = rel === '' ? 'index.html' : path.join(rel, 'index.html');
      expect(site.has(target) || site.has(rel), `${href} resolves to nothing in dist`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The empty corpus
 * ------------------------------------------------------------------ */

describe('an empty corpus builds, and the index says so in the documented words', () => {
  it('the build succeeds and every page is still produced', () => {
    for (const route of ['index.html', 'clusters/index.html', 'endpoints/index.html', 'method/index.html', 'sitemap.xml', 'clusters/rss.xml']) {
      expect(emptyScheduled.has(route), `${route} was not built from an empty corpus`).toBe(true);
    }
  });

  it('the cluster index carries the empty state document 03 specifies', () => {
    const text = emptyScheduled.read(path.join('clusters', 'index.html')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain(
      'No clusters published yet. The first probe run is scheduled for 18 September 2026. The method is published at /method in the meantime.'
    );
  });

  it('the empty state is direction rather than apology', () => {
    const text = emptyScheduled.read(path.join('clusters', 'index.html')).replace(/<[^>]+>/g, ' ');
    expect(/\bsorry\b|\bapolog/i.test(text)).toBe(false);
    expect(text).toContain('/method');
  });

  it('with no scheduled run the page still states the position without naming a date it does not hold', () => {
    const text = emptyUnscheduled.read(path.join('clusters', 'index.html')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('No clusters published yet.');
    expect(text).toContain('The method is published at /method in the meantime.');
    expect(text).not.toContain('scheduled for null');
    expect(text).not.toContain('scheduled for undefined');
    expect(text).not.toMatch(/scheduled for NaN/);
  });

  it('a figure that is zero displays as zero, and no invented figure ships', () => {
    // The scan runs over the visible text of the built pages. The word
    // "placeholder" is a legitimate HTML attribute and CSS pseudo-element, so a
    // scan of the raw bytes would report a false positive on the bakeoff form.
    const visible = emptyScheduled.files
      .filter((f) => f.endsWith('.html'))
      .map((f) => fs.readFileSync(f, 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' '))
      .join('\n')
      .replace(/\s+/g, ' ');

    const home = emptyScheduled.read('index.html').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(home).toMatch(/Endpoints observed\s+0/);
    expect(home).toMatch(/Clusters published\s+0/);
    expect(home).toMatch(/Widest price spread\s+0\.00x/);

    for (const marker of ['lorem ipsum', 'example figure', 'coming soon', 'TBD', 'to be determined']) {
      expect(new RegExp(marker, 'i').test(visible), `the empty build ships "${marker}"`).toBe(false);
    }
    expect(/\bplaceholder figure\b/i.test(visible)).toBe(false);
  });

  it('the empty build produces no cluster route and an empty feed', () => {
    expect(
      fs.readdirSync(path.join(emptyScheduled.dist, 'clusters'), { withFileTypes: true }).filter((d) => d.isDirectory())
    ).toEqual([]);
    const rss = emptyScheduled.read(path.join('clusters', 'rss.xml'));
    assertWellFormedXml(rss, 'clusters/rss.xml on an empty corpus');
    expect(rss).not.toContain('<item>');
  });
});

/* ------------------------------------------------------------------ *
 * The endpoint page
 * ------------------------------------------------------------------ */

describe('an endpoint page carries the record document 03 asks for', () => {
  const html = site.read(path.join('endpoints', ALPHA.slug, 'index.html'));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('names the hostname, the advertised operator and the advertised capability', () => {
    expect(text).toContain(ALPHA.hostname);
    expect(text).toContain('Alpha Data Company');
    expect(text).toContain('market data');
  });

  it('carries first seen, last seen, status and the source directory', () => {
    expect(text).toContain('2026-08-18');
    expect(text).toContain('2026-08-22');
    expect(text).toContain('active');
    expect(text).toContain('directory.example.test');
  });

  it('marks every price in the history as observed or recorded', () => {
    expect(text).toContain('observed');
    expect(text).toContain('recorded');
    expect(html).not.toContain('provenance="null"');
  });

  it('names its cluster and links to it', () => {
    expect(html).toContain(`/clusters/${CLUSTER_SLUG}`);
  });

  it('an endpoint in no cluster says so rather than linking to one', () => {
    const solo = site.read(path.join('endpoints', SOLO.slug, 'index.html'));
    expect(solo).not.toContain(`/clusters/${CLUSTER_SLUG}`);
    expect(solo.replace(/<[^>]+>/g, ' ')).toContain(SOLO.hostname);
  });
});
