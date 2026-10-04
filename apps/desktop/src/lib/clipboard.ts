// One place that writes to the clipboard. `navigator.clipboard.writeText`
// rejects when the webview has not been granted write permission (or the window
// is not focused), and an unawaited rejection is an unhandled one — the button
// would flash "Copied" for text that was never copied. Callers get a plain
// answer instead and say so honestly.

import { createLogger } from "./logger.ts";

const log = createLogger("clipboard");

export const COPY_FAILED_MESSAGE = "Couldn't copy to the clipboard. Select the text and copy it by hand.";

/** Resolves true once the text is on the clipboard, false if the system refused. Never throws. */
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<boolean> {
  if (!clipboard) {
    log.warn("clipboard is not available here");
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch (e) {
    log.warn("clipboard write refused", e);
    return false;
  }
}
