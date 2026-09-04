// /sitemap.xml
//
// Document 03: "Sitemap and RSS on /clusters, because being cited is the
// distribution strategy and machines need a feed to notice a new finding."
//
// The static routes are read from the page files that actually exist rather
// than from a list written by hand, so the sitemap cannot advertise a page that
// was never built. The dynamic routes come from the corpus, which holds only
// clusters the exporter selected with published = 1 - so an unpublished cluster
// cannot reach the sitemap even if something else on the site linked to it.

import { corpus, SITE, xmlEscape } from './_corpus.js';

const pageFiles = import.meta.glob('./**/*.astro');

function routeFor(file) {
  const rel = file.replace(/^\.\//, '').replace(/\.astro$/, '');
  const segments = rel.split('/');
  if (segments.some((s) => s.startsWith('_'))) return null;
  if (rel.includes('[')) return null;
  if (segments[segments.length - 1] === '404') return null;
  if (rel === 'index') return '/';
  if (segments[segments.length - 1] === 'index') return `/${segments.slice(0, -1).join('/')}/`;
  return `/${rel}/`;
}

export function GET() {
  const entries = [];

  for (const file of Object.keys(pageFiles)) {
    const route = routeFor(file);
    if (route) entries.push({ loc: route, lastmod: corpus.generated_at });
  }

  entries.push({ loc: '/clusters/rss.xml', lastmod: corpus.generated_at });

  for (const c of corpus.clusters) entries.push({ loc: `/clusters/${c.slug}/`, lastmod: c.last_updated });
  for (const e of corpus.endpoints) entries.push({ loc: `/endpoints/${e.slug}/`, lastmod: e.last_seen });

  const seen = new Set();
  const unique = entries.filter((e) => (seen.has(e.loc) ? false : (seen.add(e.loc), true)));
  unique.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${unique
  .map(
    (e) =>
      `  <url>\n    <loc>${xmlEscape(SITE.origin + e.loc)}</loc>${
        e.lastmod ? `\n    <lastmod>${xmlEscape(e.lastmod)}</lastmod>` : ''
      }\n  </url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}
