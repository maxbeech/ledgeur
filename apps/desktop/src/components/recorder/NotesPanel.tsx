// Notes typed during the meeting. Kept in the recorder context (they survive
// navigation) and woven verbatim into the final summary and export.
export function NotesPanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex h-full flex-col">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"Anything worth remembering.\n\nDecisions as you hear them, names, numbers, promises, your own follow-ups. Kept word for word in the final notes."}
        className="ldg-prose min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-ink-text outline-none placeholder:text-faint"
        aria-label="Meeting notes" name="meeting-notes"
      />
    </div>
  );
}
