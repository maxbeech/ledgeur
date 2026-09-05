// The grounded-answer prompt. One builder, two framings.
//
// Asking a question *during* a meeting and asking one *about* your meetings are
// different jobs, and the same prompt served both badly. In a live meeting the
// answer has to be short enough to read while someone is still talking, has to
// treat the transcript as the present tense, and has to distinguish "nobody has
// said that yet" from "I don't know" — those are different, useful answers. The
// library copilot has none of those constraints and should instead be explicit
// about which meeting a claim came from.
//
// Pure, so both framings are unit-tested without a model.

import { packContext, renderContext, type ContextBlock } from "./blocks.ts";

export type GroundingMode = "meeting" | "library";

export interface GroundedMessage {
  role: "system" | "user";
  content: string;
}

const SHARED_RULES =
  "Answer using ONLY the context blocks below. Cite the source name in parentheses after " +
  "any claim that came from one. Never invent names, numbers, commitments or quotes. " +
  "If the context does not contain the answer, say so plainly and say what would.";

const MEETING_SYSTEM =
  "You are Ledgeur's meeting copilot. You are listening to a meeting that is happening " +
  "right now, and the user has asked you something mid-conversation — they may be about " +
  "to speak, so be brief and direct. Two or three sentences unless asked for more; a short " +
  "list when the answer is genuinely a list. " +
  SHARED_RULES +
  " The live transcript is the meeting so far: it is speech-to-text, so it contains " +
  "mishearings — prefer what is consistent across several lines over any single odd word, " +
  "and say when a name or number looks garbled rather than repeating it as fact. Lines are " +
  "prefixed with a timestamp and the speaker's label. If something has simply not come up " +
  "yet, say that it has not been discussed — that is different from not knowing. Context " +
  "blocks other than the transcript are the company's existing knowledge; use them to " +
  "answer things the room has not covered, and always mark clearly which is which.";

const LIBRARY_SYSTEM =
  "You are Ledgeur, an assistant with access to the user's meeting record and their " +
  "company's connected knowledge. " +
  SHARED_RULES +
  " When several sources disagree, say so and give both, with dates where you have them, " +
  "rather than silently picking one.";

export interface BuildGroundedOptions {
  mode?: GroundingMode;
  /** Character budget for the rendered context. */
  budget?: number;
  /** Prepended to the user turn, e.g. the meeting's title and elapsed time. */
  situation?: string;
}

export interface GroundedPrompt {
  messages: GroundedMessage[];
  /** The blocks that actually made it into the prompt — this is what the UI
   *  shows as "what this answer could see". */
  used: ContextBlock[];
  dropped: string[];
}

/** Build the messages for a grounded answer, packing context to the budget. */
export function buildGroundedPrompt(
  question: string,
  context: readonly ContextBlock[],
  options: BuildGroundedOptions = {},
): GroundedPrompt {
  const { mode = "library", budget, situation } = options;
  const packed = packContext(question, context, budget);
  const head = situation?.trim() ? `${situation.trim()}\n\n` : "";
  return {
    messages: [
      { role: "system", content: mode === "meeting" ? MEETING_SYSTEM : LIBRARY_SYSTEM },
      {
        role: "user",
        content: `${head}Context:\n\n${renderContext(packed.blocks)}\n\n---\nQuestion: ${question}`,
      },
    ],
    used: packed.blocks,
    dropped: packed.dropped,
  };
}
