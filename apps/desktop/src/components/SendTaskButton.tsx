// "Put this one in Linear."
//
// One action item, one button, and afterwards a link rather than a second copy.
// It appears only when a destination is configured: an unset button that
// explains it is unset is a worse row than no button at all, and Settings is
// where that gets fixed.

import { useState, useSyncExternalStore } from "react";
import { Send, ExternalLink, TriangleAlert } from "lucide-react";
import { taskTargetById } from "@ledgeur/core";
import { IconButton, Spinner } from "./ui.tsx";
import { getPushed, pushTask, pushedTo, subscribePushed, taskPushReady, currentConfig } from "../lib/taskPush.ts";
import type { TaskItem } from "../lib/useTasks.ts";

export function SendTaskButton({ task }: { task: TaskItem }) {
  // Subscribed rather than read once: sending one task must update its own row
  // without re-rendering the whole list, and the auto-push writes here too.
  useSyncExternalStore(subscribePushed, getPushed, getPushed);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const config = currentConfig();
  if (!config || !taskPushReady()) return null;
  const target = taskTargetById(config.target);
  const already = pushedTo(task.key);

  if (already) {
    return already.url ? (
      <a
        href={already.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-accent-strong hover:underline"
      >
        In {target?.name} <ExternalLink className="h-3 w-3" />
      </a>
    ) : (
      <span className="shrink-0 px-2 py-1 text-xs text-faint">In {target?.name}</span>
    );
  }

  async function send() {
    setSending(true);
    setError("");
    try {
      const result = await pushTask(task.key, {
        title: task.text,
        meetingTitle: task.meetingTitle,
        meetingUrl: task.meetingId ? `ledgeur://meeting/${task.meetingId}` : undefined,
      });
      if (!result.ok) setError(result.error ?? "It did not go.");
    } finally {
      setSending(false);
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {error && (
        <span title={error} className="inline-flex items-center gap-1 text-xs text-danger">
          <TriangleAlert className="h-3.5 w-3.5" /> Failed
        </span>
      )}
      <IconButton
        label={`Send to ${target?.name ?? "your task manager"}`}
        tone="ghost"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void send(); }}
        disabled={sending}
      >
        {sending ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
      </IconButton>
    </span>
  );
}
