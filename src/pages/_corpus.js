// Build-time data access and formatting for the pre-rendered pages.
//
// The underscore prefix keeps this out of the route table. It is imported by
// the cluster and endpoint pages, the sitemap and the feed, so that every one of
// them reads the corpus the same way and formats a figure the same way.
//
// Document 02, routes: the built site never queries D1 at runtime. Everything
// here is resolved while the site is being built, from the file that
// crosspeel-engine/scripts/export-site-data.mjs wrote.

import corpus from '../data/corpus.json';

export { corpus };

export const SITE = {
  origin: 'https://crosspeel.com',
  disputeEmail: 'disputes@crosspeel.com',
  repository: 'https://github.com/tjhoags/crosspeel',
};

// The dispute invitation is fixed wording from document 03 and is reproduced
// verbatim on every cluster page. It is not rewritten per cluster.
export const DISPUTE_INVITATION =
  'If you operate one of these endpoints and believe this finding is wrong, write to disputes@crosspeel.com with the endpoint URL and what you believe is inaccurate. Disputes are published on this page alongside the finding, whatever the outcome.';

// The shared layout is written at runbook step D3 and these pages are step D4.
// Resolved through a glob rather than a static import so that this step builds
// and can be verified on its own, and adopts the shared chrome the moment it
// lands. The interface expected of it is { title, description, observed }.
const layoutModules = import.meta.glob('../layouts/*.astro', { eager: true });
export const BaseLayout =
  layoutModules['../layouts/Base.astro']?.default ??
  layoutModules['../layouts/BaseLayout.astro']?.default ??
  layoutModules['../layouts/Layout.astro']?.default ??
  null;

// Design tokens are written at runbook step D1. Same reasoning as the layout.
import.meta.glob('../styles/*.css', { eager: true });

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/**
 * A price, written for a reader.
 *
 * Two decimal places is the house rule and it holds from one cent upwards. It
 * cannot hold below one cent: the price census of 2026-09-04 measured a median
 * call price of 0.01 USD and a 25th percentile of 0.00, so a figure of 0.0025
 * written to two places is 0.00, and a spread computed from that is not a
 * number. Below a cent the digits that were actually paid are written instead.
 */
export function usd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const twoPlaces = n.toFixed(2);
  // Two places wherever two places is the true figure. Where it is not - a call
  // priced at 0.0105 written as 0.01 - the digits that were paid are written
  // instead, because a reader dividing one price by another has to arrive at the
  // spread multiple the same page states.
  if (Number(twoPlaces) === n) return twoPlaces;
  return n.toFixed(8).replace(/0+$/, '');
}

/** A ratio. Always two decimal places. */
export function multiple(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/** Milliseconds, two decimal places. */
export function ms(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n.toFixed(2);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Display date. Document 02 allows "4 September 2026" next to the machine
 * readable value, and every one of these is rendered inside a <time> element
 * carrying the ISO 8601 UTC string it came from.
 */
export function dateHuman(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function toRfc822(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toUTCString();
}

export function xmlEscape(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A value captured from a response, rendered as text. Never invented. */
export function captured(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** A stable css identifier fragment. Used for generated selectors only. */
export function cssId(s) {
  return String(s || 'none')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'none';
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/**
 * The claim, in one sentence. Document 03 gives the shape and it is not
 * embellished. Where no price has been paid yet the price clause states that
 * rather than quoting an advertised figure as an observed one.
 */
export function clusterClaim(cluster) {
  const head = `${cluster.member_count} endpoints returned identical responses across ${cluster.matched_fields} of ${cluster.compared_fields} compared fields.`;
  const min = usd(cluster.min_price_usd);
  const max = usd(cluster.max_price_usd);
  const spread = multiple(cluster.spread_multiple);
  if (min === null || max === null) {
    return `${head} No price has been observed for these endpoints yet.`;
  }
  if (spread === null) {
    return `${head} Observed prices range from $${min} to $${max}.`;
  }
  return `${head} Observed prices range from $${min} to $${max}, a spread of ${spread}x.`;
}

/** The newest observation date this page rests on, for <meta name="observed">. */
export function observedThrough(cluster) {
  return cluster?.observation_window?.to || cluster?.last_updated || corpus.observed_through;
}

// ---------------------------------------------------------------------------
// Sorting and filtering inputs, computed at build
// ---------------------------------------------------------------------------

function cmpDesc(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? 1 : -1;
}

/** Date last observed for a cluster, falling back to when the row last changed. */
export function lastObserved(cluster) {
  return cluster.observation_window?.to || cluster.last_updated || null;
}

/**
 * Ranks for the three sort orders on /clusters. Computed here so the index can
 * reorder without JavaScript: every row carries its position under each order as
 * a custom property, and a checked radio decides which one applies.
 */
export function sortRanks(clusters) {
  const rank = new Map(clusters.map((c) => [c.slug, { observed: 0, spread: 0, members: 0 }]));
  const assign = (key, list) => list.forEach((c, i) => (rank.get(c.slug)[key] = i));
  assign('observed', [...clusters].sort((a, b) => cmpDesc(lastObserved(a), lastObserved(b))));
  assign('spread', [...clusters].sort((a, b) => cmpDesc(a.spread_multiple, b.spread_multiple)));
  assign('members', [...clusters].sort((a, b) => cmpDesc(a.member_count, b.member_count)));
  return rank;
}

/** Every capability present on a published cluster, in alphabetical order. */
export function capabilityFacets(clusters) {
  const seen = new Map();
  for (const c of clusters) {
    const key = c.capability || 'unclassified';
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([value, count]) => ({ value, count }));
}

/** Confidence values present, ordered high, moderate, low. */
export function confidenceFacets(clusters) {
  const order = ['high', 'moderate', 'low'];
  const seen = new Map();
  for (const c of clusters) seen.set(c.confidence, (seen.get(c.confidence) || 0) + 1);
  return order.filter((v) => seen.has(v)).map((value) => ({ value, count: seen.get(value) }));
}

/** Every unordered pair of cluster members, for the diff pane selector. */
export function memberPairs(members) {
  const pairs = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) pairs.push([members[i], members[j]]);
  }
  return pairs;
}
