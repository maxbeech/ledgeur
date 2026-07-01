import type { Metadata } from "next";
import Link from "next/link";
import { COMPETITORS } from "@/lib/competitors";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Open-source alternatives to AI meeting notetakers",
  description:
    "Compare ParleyNotes — the open-source, on-device AI meeting assistant — with Granola, Otter.ai, Fireflies, Fathom, tl;dv and more. Private, free for individuals.",
  alternates: { canonical: `${SITE.url}/alternatives` },
};

export default function AlternativesIndex() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-14">
      <h1 className="text-3xl font-extrabold tracking-tight">A private, open alternative to every AI notetaker</h1>
      <p className="mt-3 max-w-2xl text-stone-600">
        Most meeting-notes tools are closed-source and upload your audio to their cloud. ParleyNotes runs in your
        browser and is MIT-licensed. Here’s how it compares.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {COMPETITORS.map((c) => (
          <Link key={c.slug} href={`/alternatives/${c.slug}`} className="rounded-xl border border-stone-200 bg-white p-5 hover:border-emerald-300">
            <div className="font-semibold text-stone-900">ParleyNotes vs {c.name}</div>
            <p className="mt-1 text-sm text-stone-600">{c.what}</p>
            <span className="mt-3 inline-block text-sm font-medium text-emerald-700">Compare →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
