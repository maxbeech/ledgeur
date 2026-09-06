// Ledgeur against a hosted notetaker, as a table. Defined once: the home page
// and the pricing page both show it, and they used to carry two copies of the
// same markup.
import { COMPARISON } from "@/lib/plans";

export function ComparisonTable() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-hairline bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-left text-base">
        <caption className="sr-only">Ledgeur compared with a typical cloud AI notetaker</caption>
        <thead>
          <tr className="border-b border-hairline bg-paper">
            <th scope="col" className="px-5 py-3.5 text-sm font-semibold text-faint" />
            <th scope="col" className="px-5 py-3.5 text-sm font-semibold text-brand-strong">Ledgeur</th>
            <th scope="col" className="px-5 py-3.5 text-sm font-semibold text-faint">A hosted notetaker</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON.map((row) => (
            <tr key={row.point} className="border-b border-hairline align-top last:border-0">
              <th scope="row" className="px-5 py-4 font-semibold text-ink-text">{row.point}</th>
              <td className="px-5 py-4 text-ink-text">{row.ledgeur}</td>
              <td className="px-5 py-4 text-muted">{row.them}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
