// The one "Send feedback" control. It opens Sentry's feedback form, so a note
// from a person lands in the same Sentry project as the app's own errors.
import { useCallback, useState } from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { useSession } from "../lib/session.ts";
import { openFeedbackForm } from "../lib/sentry.ts";

/** `row` matches the sidebar's quiet rows; `card` is the Settings version. */
export function FeedbackButton({ variant = "row", className }: { variant?: "row" | "card"; className?: string }) {
  const { session } = useSession();
  const [unavailable, setUnavailable] = useState(false);
  const email = session?.user?.email ?? null;
  const name = (session?.user?.user_metadata as { name?: string } | undefined)?.name ?? null;

  const open = useCallback(async () => {
    const opened = await openFeedbackForm({ email, name });
    if (!opened) setUnavailable(true);
  }, [email, name]);

  const label = unavailable ? "Feedback is not switched on in this build" : "Send feedback";

  return (
    <button
      type="button"
      onClick={open}
      data-testid="feedback-button"
      disabled={unavailable}
      className={cn(
        variant === "row"
          ? "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-base font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink-text"
          : "flex h-11 w-full items-center gap-2.5 rounded-xl border border-hairline-strong bg-surface px-4 text-base font-medium text-ink-text transition-colors hover:bg-surface-muted",
        unavailable && "cursor-default opacity-60",
        className,
      )}
    >
      <MessageSquare className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
      {label}
    </button>
  );
}
