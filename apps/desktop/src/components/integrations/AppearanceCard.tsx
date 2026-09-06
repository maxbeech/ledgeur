// Light, dark, or follow the system. Applied immediately (lib/theme.ts), so
// the choice is seen, not described.
import { Sun, Moon, Monitor } from "lucide-react";
import { Card, Segmented } from "../ui.tsx";
import { useSetting, setSetting } from "../../lib/settings.ts";

const OPTIONS = [
  { value: "system", label: <><Monitor className="h-4 w-4" /> System</> },
  { value: "light", label: <><Sun className="h-4 w-4" /> Light</> },
  { value: "dark", label: <><Moon className="h-4 w-4" /> Dark</> },
] as const;

export function AppearanceCard() {
  const theme = useSetting("theme");
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <div className="text-base font-semibold text-ink-text">Theme</div>
        <p className="mt-0.5 text-sm text-muted">Follow your system, or pick one.</p>
      </div>
      <Segmented options={OPTIONS} value={theme} onChange={(v) => setSetting("theme", v)} />
    </Card>
  );
}
