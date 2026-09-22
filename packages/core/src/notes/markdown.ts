// A deliberately small Markdown reader for one thing: `detailedNotes`, the
// free-form write-up the model produces (see `DETAILED_SYSTEM` in
// apps/desktop/src/lib/notes.ts). Not a general Markdown parser — the prompt
// only ever asks for `##` headings, plain paragraphs and `-`/`*` bullets, so
// that is all this reads. Pure, so the UI's rendering of a model's free text
// is testable without a browser.

export type NotesMarkdownBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/** Read `##`/`###`/… headings, `-`/`*` bullet lists and plain paragraphs out
 *  of Markdown text. Anything else (tables, links, emphasis) is left as plain
 *  text inside whichever block it fell into — this exists to structure the
 *  write-up, not to fully render it. */
export function parseNotesMarkdown(markdown: string): NotesMarkdownBlock[] {
  const blocks: NotesMarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };

  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: heading[1].trim() });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1].trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
