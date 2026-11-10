// URLs that were merged into another page. The losing URL has no page of its
// own any more: its entry is gone from COMPETITORS or POSTS, so it drops out of
// the sitemap, and next.config.ts answers it with a permanent 301 to the page
// that now carries its material.
//
// Add a row when a page is merged or removed, and keep the reason beside it so
// a later edit does not quietly undo the decision. Redirect docs:
// https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects
//
// Each row was chosen on 90-day Search Console data (2026-08-06 to 2026-11-03)
// for the query cluster both URLs served: the page with more impressions, or
// the one whose title matches the head query, is the destination.

export interface ContentRedirect {
  /** The path that no longer has its own page. */
  from: string;
  /** The page that now carries its material. */
  to: string;
  /** Why the merge happened, kept with the row. */
  reason: string;
}

export const CONSOLIDATED_REDIRECTS: readonly ContentRedirect[] = [
  {
    from: "/alternatives/granola",
    to: "/blog/open-source-granola-alternative",
    reason: "Same granola alternative query. The article had 75 impressions at position 15.3, the comparison page 8 at position 15.8.",
  },
  {
    from: "/alternatives/otter-ai",
    to: "/blog/otter-ai-alternatives",
    reason: "Same Otter alternatives cluster. The article is the listicle that answers 'otter ai alternatives' and ranks at 50.6, the comparison page at 79.7 with 18 impressions.",
  },
  {
    from: "/blog/automatic-notes-in-microsoft-teams",
    to: "/blog/how-to-transcribe-microsoft-teams-meetings",
    reason: "Same Teams transcription query. The how-to has primary sources and no licence-tier claims that go stale, and both pages ranked near position 9 for it.",
  },
  {
    from: "/blog/fireflies-vs-otter-vs-ledgeur",
    to: "/blog/meeting-recording-transcription-software-compared",
    reason: "Same software-comparison cluster. The comparison page had 24 impressions at position 14.8 and the Fireflies page 2 at position 6.5, so the Fireflies, Otter and Ledgeur material (bot, audio location, pricing, open source) now sits in the comparison page with its Fireflies claims corrected and sourced.",
  },
  {
    from: "/blog/mcp-meeting-records-explained",
    to: "/blog/meeting-notes-for-ai-agents",
    reason: "Same AI-agent meeting-records cluster. The agents article had 10 impressions at position 12.6, the MCP guide 2 at position 6. Its tool-boundary material (narrow tools, caller identity, error paths, privileged-account testing) now sits in the agents article.",
  },
];

/** The shape next.config.ts hands to Next.js: a permanent 301 per merged path. */
export const consolidatedRedirectRules = () =>
  CONSOLIDATED_REDIRECTS.map(({ from, to }) => ({
    source: from,
    destination: to,
    statusCode: 301 as const,
  }));
