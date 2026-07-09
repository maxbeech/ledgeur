// Convert Ledgeur note Markdown into Notion block objects. Pure and
// dependency-free, so it is unit-tested. Supports the subset our notes emit:
// H1/H2 headings, bulleted list items, to-do checkboxes, and paragraphs.

export interface NotionBlock {
  object: "block";
  type: string;
  [key: string]: unknown;
}

const rich = (content: string) => [{ type: "text", text: { content: content.slice(0, 2000) } }];

function lineToBlock(line: string): NotionBlock | null {
  const t = line.trimEnd();
  if (t.trim() === "") return null;

  if (t.startsWith("## ")) return { object: "block", type: "heading_2", heading_2: { rich_text: rich(t.slice(3)) } };
  if (t.startsWith("# ")) return { object: "block", type: "heading_1", heading_1: { rich_text: rich(t.slice(2)) } };

  const todo = t.match(/^-\s\[( |x|X)\]\s(.*)$/);
  if (todo) {
    return {
      object: "block",
      type: "to_do",
      to_do: { rich_text: rich(todo[2]), checked: todo[1].toLowerCase() === "x" },
    };
  }

  if (t.startsWith("- ")) return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(t.slice(2)) } };

  // Drop the italic date meta line and horizontal rules; everything else is a paragraph.
  if (/^_.*_$/.test(t.trim())) return { object: "block", type: "paragraph", paragraph: { rich_text: rich(t.replace(/^_|_$/g, "")) } };
  return { object: "block", type: "paragraph", paragraph: { rich_text: rich(t) } };
}

/** Markdown → Notion blocks. Blank lines are collapsed (no empty paragraphs). */
export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  return markdown
    .split("\n")
    .map(lineToBlock)
    .filter((b): b is NotionBlock => b !== null);
}

/** Notion caps children at 100 per request; split into appendable chunks. */
export function chunkBlocks(blocks: NotionBlock[], size = 100): NotionBlock[][] {
  const out: NotionBlock[][] = [];
  for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size));
  return out;
}
