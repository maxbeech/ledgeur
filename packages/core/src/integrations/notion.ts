// Notion API client — the first note-taking integration. Saves a meeting's notes
// as a page under a chosen Notion database or page. Secrets (the access token)
// are supplied by the caller; this module never stores them.

import { markdownToNotionBlocks, chunkBlocks, type NotionBlock } from "./notion-blocks.ts";

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

export interface NotionTarget {
  /** Exactly one of these identifies where the page is created. */
  databaseId?: string;
  pageId?: string;
}

async function notion(token: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Notion error ${res.status}: ${String(data.message ?? "").slice(0, 200)}`);
  }
  return data;
}

/** Build the parent + title-property payload for a new page. */
export function buildNotionPage(target: NotionTarget, title: string, firstBlocks: NotionBlock[]) {
  if (!target.databaseId && !target.pageId) {
    throw new Error("A Notion databaseId or pageId is required.");
  }
  const parent = target.databaseId
    ? { type: "database_id", database_id: target.databaseId }
    : { type: "page_id", page_id: target.pageId };
  // In a database the title lives in the "title" property; under a page we still
  // pass a title property (Notion ignores it for page parents but our H1 covers it).
  return {
    parent,
    properties: { title: { title: [{ type: "text", text: { content: title.slice(0, 2000) } }] } },
    children: firstBlocks,
  };
}

/** Create a Notion page from note Markdown, appending overflow blocks in chunks.
 *  Returns the new page's URL. */
export async function saveNotesToNotion(opts: {
  token: string;
  target: NotionTarget;
  title: string;
  markdown: string;
}): Promise<string> {
  const chunks = chunkBlocks(markdownToNotionBlocks(opts.markdown));
  const page = await notion(opts.token, "/pages", buildNotionPage(opts.target, opts.title, chunks[0] ?? []));
  const pageId = String(page.id ?? "");
  for (const chunk of chunks.slice(1)) {
    await notion(opts.token, `/blocks/${pageId}/children`, { children: chunk });
  }
  return String(page.url ?? "");
}

export { markdownToNotionBlocks, chunkBlocks };
