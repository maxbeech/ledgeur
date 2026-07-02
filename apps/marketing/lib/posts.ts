// Aggregator + single source of truth for blog posts. Add new posts to the
// themed files in lib/posts/ and they flow through to the index, post pages and
// sitemap automatically.

import type { Post, Block } from "./posts/post-types";
import { SET_1 } from "./posts/set-1";
import { SET_2 } from "./posts/set-2";
import { SET_3 } from "./posts/set-3";

export type { Post, Block };

export const POSTS: Post[] = [...SET_1, ...SET_2, ...SET_3].sort((a, b) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
);

export const postBySlug = (slug: string) => POSTS.find((p) => p.slug === slug);
