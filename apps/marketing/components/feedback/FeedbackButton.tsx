"use client";

import { useCallback, useState } from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "@ledgeur/ui";
import EmailLink from "@/components/EmailLink";
import { openFeedbackForm } from "./open-feedback";

/**
 * The one "Send feedback" control on the site. It opens Sentry's feedback
 * dialog, so a note from a person lands in the same Sentry project as the
 * exceptions from the code.
 *
 * `link` sits in the marketing footer; `row` is the quieter in-app version for
 * the /app sidebar. Pass `user` when the person is signed in so the form
 * arrives pre-filled.
 */
export function FeedbackButton({
  variant = "link",
  className,
  user,
}: {
  variant?: "link" | "row";
  className?: string;
  user?: { email?: string | null; name?: string | null };
}) {
  const [unavailable, setUnavailable] = useState(false);

  const open = useCallback(async () => {
    const opened = await openFeedbackForm(user);
    if (!opened) setUnavailable(true);
  }, [user]);

  if (unavailable) {
    return (
      <span className={cn("text-sm text-muted", className)}>
        Feedback is not switched on here. <EmailLink label="Email us" subject="Ledgeur feedback" className="underline underline-offset-2" />.
      </span>
    );
  }

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={open}
        data-testid="feedback-button"
        className={cn(
          "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink-text",
          className,
        )}
      >
        <MessageSquare className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        Send feedback
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      data-testid="feedback-button"
      className={cn("font-medium transition-colors hover:text-ink-text", className)}
    >
      Send feedback
    </button>
  );
}
