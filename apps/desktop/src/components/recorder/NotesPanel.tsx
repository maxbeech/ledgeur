// Manual notes taken during the meeting. Kept in the recorder context (they
// survive navigation) and woven verbatim into the final summary + export.
import { PenLine } from "lucide-react";

export function NotesPanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pb-1 pt-3 text-[11px] text-faint">
        <PenLine className="h-3.5 w-3.5" />
        Kept word-for-word in the final notes.
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"Type anything worth remembering…\n\n– decisions as you hear them\n– names, numbers, promises\n– your own follow-ups"}
        className="pn-prose min-h-0 flex-1 resize-none bg-transparent px-4 py-2 text-[13.5px] leading-relaxed text-ink-text outline-none placeholder:text-faint/80"
        aria-label="Meeting notes" name="meeting-notes"
      />
    </div>
  );
}
