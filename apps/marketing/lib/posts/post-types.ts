// Shared types for blog posts. Kept separate so post data files and the
// aggregator can both import the type without a circular dependency.

export type Source = { label: string; href: string };

export type Block =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string; attribution: string; href: string }
  | { type: "callout"; title: string; text: string }
  | { type: "table"; caption: string; headers: string[]; rows: string[][] }
  | { type: "links"; label: string; links: Source[] };

export type PostCategory = "Academy" | "News" | "Reviews";
export type SchemaType = "HowTo" | "FAQPage" | "Review";

export interface Post {
  slug: string;
  title: string;
  description: string;
  keyword: string;
  date: string; // YYYY-MM-DD
  /** Date of a material editorial revision. Never update this just to make a
   * page appear fresh: it feeds both article metadata and the sitemap. */
  updated?: string; // YYYY-MM-DD
  readMins: number;
  body: Block[];
  /** Optional editorial fields make the campaign auditable without duplicating
   * them in routes, sitemaps, or JSON-LD. Older posts remain valid. */
  category?: PostCategory;
  supportingKeywords?: string[];
  longTailKeywords?: string[];
  faqs?: { question: string; answer: string }[];
  sources?: Source[];
  internalLinks?: Source[];
  schemaTypes?: SchemaType[];
  campaign?: string;
  featuredImageAlt?: string;
  expertReviewNote?: string;
}
