// /clusters/rss.xml
//
// Document 03: being cited is the distribution strategy and machines need a feed
// to notice a new finding.
//
// One item per published cluster, newest first. The item description is the same
// one sentence claim the cluster page carries, so a reader who never leaves the
// feed still gets the finding with its figures and no characterisation attached.

import { corpus, SITE, clusterClaim, toRfc822, xmlEscape } from '../_corpus.js';

export function GET() {
  const items = [...corpus.clusters].sort((a, b) => {
    const ka = a.first_published || a.last_updated || '';
    const kb = b.first_published || b.last_updated || '';
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });

  const lastBuild = toRfc822(corpus.generated_at) || toRfc822(new Date().toISOString());

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Crosspeel clusters</title>
    <link>${xmlEscape(SITE.origin)}/clusters/</link>
    <atom:link href="${xmlEscape(SITE.origin)}/clusters/rss.xml" rel="self" type="application/rss+xml" />
    <description>Published clusters. Each item is a set of endpoints that returned identical responses, with the price range observed across them.</description>
    <language>en</language>
    <lastBuildDate>${xmlEscape(lastBuild)}</lastBuildDate>
    <generator>Crosspeel</generator>
${items
  .map((c) => {
    const url = `${SITE.origin}/clusters/${c.slug}/`;
    const pub = toRfc822(c.first_published || c.last_updated);
    return `    <item>
      <title>${xmlEscape(`Cluster ${c.slug} - ${c.capability || 'unclassified'}`)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>${pub ? `\n      <pubDate>${xmlEscape(pub)}</pubDate>` : ''}
      <description>${xmlEscape(clusterClaim(c))}</description>
    </item>`;
  })
  .join('\n')}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
}
