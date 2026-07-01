import type { Metadata } from "next";
import Link from "next/link";
import { USE_CASES } from "@/lib/usecases";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "AI meeting notes for every kind of meeting",
  description:
    "Private AI meeting notes for sales calls, user interviews, standups, 1:1s, hiring, lectures and more. On-device transcription, free for individuals.",
  alternates: { canonical: `${SITE.url}/use-cases` },
};

export default function UseCasesIndex() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-14">
      <h1 className="text-3xl font-extrabold tracking-tight">Notes for every kind of meeting</h1>
      <p className="mt-3 max-w-2xl text-stone-600">However you meet, ParleyNotes turns it into clean, private notes — on your device.</p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {USE_CASES.map((u) => (
          <Link key={u.slug} href={`/use-cases/${u.slug}`} className="rounded-xl border border-stone-200 bg-white p-5 hover:border-emerald-300">
            <div className="font-semibold text-stone-900">{u.name}</div>
            <p className="mt-1 text-sm text-stone-600">{u.headline}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
