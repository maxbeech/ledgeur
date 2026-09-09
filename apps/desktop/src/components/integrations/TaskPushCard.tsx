// Where action items go when they leave the meeting.
//
// The card is built from the destination catalogue in @ledgeur/core rather than
// from three hand-written forms, so adding a fourth task manager is a data
// change and this file does not move. Each field carries the path through that
// product's own settings to the value it wants, because "Team ID" is not a
// thing anybody has to hand and hunting for it is where people give up.

import { useState } from "react";
import { CheckSquare, Send, Check, TriangleAlert, Eye, EyeOff, ExternalLink } from "lucide-react";
import { TASK_TARGETS, taskTargetById, type TaskPushResult } from "@ledgeur/core";
import { Badge, Button, Card, ErrorNote, Field, IconButton, Input, Label, Select, Spinner, Toggle } from "../ui.tsx";
import { useSettings, setSetting } from "../../lib/settings.ts";
import { configError, pushTask, taskPushReady } from "../../lib/taskPush.ts";

/** Settings key each catalogue field writes to. One mapping, so a new field in
 *  core cannot silently write nowhere. */
const FIELD_KEY = {
  token: "taskToken",
  container: "taskContainer",
  workspace: "taskWorkspace",
} as const;

export function TaskPushCard() {
  const settings = useSettings();
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TaskPushResult | null>(null);

  const target = taskTargetById(settings.taskTarget);
  const problem = configError();
  const ready = taskPushReady();

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      // A real task, created for real, and said so on the button. A "test" that
      // does not write anything proves the token parses and nothing else.
      setResult(await pushTask(`test:${Date.now()}`, {
        title: "Ledgeur test task",
        meetingTitle: "A test from Ledgeur settings",
      }));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <CheckSquare className="h-4 w-4 text-brand-strong" />
        <Label>Action items</Label>
        {target
          ? <Badge tone={ready ? "accent" : "danger"}>{ready ? target.name : "Needs a detail"}</Badge>
          : <Badge>Off</Badge>}
      </div>
      <p className="mb-4 max-w-xl text-sm leading-relaxed text-muted">
        Send an action item straight from the Tasks list into the place you actually keep work.
        Ledgeur creates the task and remembers the link back; it does not read your task list, and
        closing something there does not close it here.
      </p>

      <div className="space-y-4">
        <Field label="Destination" htmlFor="task-target">
          <Select
            id="task-target"
            value={settings.taskTarget}
            onChange={(e) => {
              // Clearing the credential on a change of destination is the point:
              // a Linear key left behind and sent to Asana is a token leaked to
              // a third party for no benefit.
              setSetting("taskTarget", e.target.value);
              setSetting("taskToken", "");
              setSetting("taskContainer", "");
              setSetting("taskWorkspace", "");
              setResult(null);
            }}
          >
            <option value="">Off</option>
            {TASK_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>

        {target && (
          <>
            {target.fields.map((field) => {
              const key = FIELD_KEY[field.key];
              const value = settings[key];
              return (
                <Field
                  key={field.key}
                  label={field.required ? field.label : `${field.label} (optional)`}
                  htmlFor={`task-${field.key}`}
                  hint={field.hint}
                >
                  {field.secret ? (
                    <div className="flex items-center gap-2">
                      <Input
                        id={`task-${field.key}`}
                        type={showToken ? "text" : "password"}
                        value={value}
                        onChange={(e) => setSetting(key, e.target.value)}
                        className="font-mono text-sm"
                      />
                      <IconButton
                        label={showToken ? "Hide the token" : "Show the token"}
                        tone="secondary"
                        onClick={() => setShowToken((v) => !v)}
                      >
                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </IconButton>
                    </div>
                  ) : (
                    <Input
                      id={`task-${field.key}`}
                      value={value}
                      onChange={(e) => setSetting(key, e.target.value)}
                      className="font-mono text-sm"
                    />
                  )}
                </Field>
              );
            })}

            <a
              href={target.credentialsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-strong hover:underline"
            >
              Where to find these in {target.name} <ExternalLink className="h-3.5 w-3.5" />
            </a>

            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-medium text-ink-text">Send every action item automatically</div>
                <p className="mt-0.5 text-xs leading-relaxed text-faint">
                  Off by default. A meeting produces action items whether or not they were meant as
                  tasks, and twenty issues nobody asked for is worse than pressing a button four times.
                </p>
              </div>
              <Toggle
                on={settings.taskAutoPush}
                onChange={(v) => setSetting("taskAutoPush", v)}
                label="Send every action item automatically"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" tone="secondary" onClick={() => void test()} disabled={!ready || testing}>
                {testing ? <Spinner /> : <Send className="h-4 w-4" />}{" "}
                {testing ? "Sending" : `Create a test task in ${target.name}`}
              </Button>
              {result && (
                result.ok
                  ? <span className="inline-flex items-center gap-1.5 text-sm text-accent-strong">
                      <Check className="h-4 w-4" /> Created.{" "}
                      {result.url && <a href={result.url} target="_blank" rel="noreferrer" className="underline">Open it</a>}
                    </span>
                  : <span className="inline-flex items-center gap-1.5 text-sm text-danger">
                      <TriangleAlert className="h-4 w-4" /> {result.error}
                    </span>
              )}
            </div>

            {problem && <ErrorNote>{problem}</ErrorNote>}

            <p className="text-xs leading-relaxed text-faint">
              The token is kept on this device, in the same place as the webhook signing secret.
              It is a personal token on a personal machine, not a team credential: anything that can
              read this device can read it.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
