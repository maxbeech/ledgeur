// Shared types for blog posts. Kept separate so post data files and the
// aggregator can both import the type without a circular dependency.

export type Block =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

export interface Post {
  slug: string;
  title: string;
  description: string;
  keyword: string;
  date: string; // YYYY-MM-DD
  readMins: number;
  body: Block[];
}
