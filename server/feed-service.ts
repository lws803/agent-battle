import { getFeedItems } from "./game";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function buildRssFeed(): Promise<string> {
  const items = await getFeedItems(50);
  // Reverse so newest is first
  const reversed = [...items].reverse();

  const baseUrl = `http://localhost:${process.env.PORT ?? 3000}`;

  const itemsXml = reversed
    .map(
      (item, idx) => `
    <item>
      <title>${escapeXml(item.title)}</title>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${escapeXml(item.pub_date)}</pubDate>
      <guid isPermaLink="false">${escapeXml(item.match_id)}-${idx}</guid>
      <link>${escapeXml(baseUrl)}/feed.xml</link>
    </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AgentArena — Live Match Feed</title>
    <description>Real-time AI agent arena results</description>
    <link>${escapeXml(baseUrl)}/feed.xml</link>
    <ttl>1</ttl>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`;
}
