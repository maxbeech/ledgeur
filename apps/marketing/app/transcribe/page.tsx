import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORMS } from "@/lib/platforms";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Transcribe any meeting — Zoom, Google Meet, Teams & more",
  description:
    "Free, private meeting transcription for Zoom, Google Meet, Microsoft Teams, Webex and more. ParleyNotes transcribes in your browser — no bot, no cloud upload.",
  alternates: { canonical: `${SITE.url}/transcribe` },
};

export default function TranscribeIndex() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-14">
      <h1 className="text-3xl font-extrabold tracking-tight">Transcribe any meeting, privately</h1>
      <p className="mt-3 max-w-2xl text-stone-600">
        Whichever platform your meeting runs on, ParleyNotes captures the audio in your browser and builds a
        transcript on your device. No bot joins the call and nothing is uploaded.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORMS.map((p) => (
          <Link key={p.slug} href={`/transcribe/${p.slug}`} className="rounded-xl border border-stone-200 bg-white p-5 hover:border-emerald-300">
            <div className="font-semibold capitalize text-stone-900">{p.name} transcription</div>
            <span className="mt-2 inline-block text-sm font-medium text-emerald-700">How to →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
