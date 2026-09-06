// The app's UI primitives ARE the shared ones. This file exists so a screen can
// import from "../components/ui.tsx" and get exactly what the site gets — one
// button, one card, one badge — plus the two layout helpers only an app needs.
import type { ReactNode } from "react";
import { Label } from "@ledgeur/ui/components";

export * from "@ledgeur/ui/components";

/** A section label with an optional action on the right. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <Label as="h2">{title}</Label>
      {action}
    </div>
  );
}
