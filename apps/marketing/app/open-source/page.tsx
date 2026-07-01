import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Open source — the self-hostable AI meeting assistant",
  description:
    "ParleyNotes is MIT-licensed and self-hostable. Run the open-source AI meeting notetaker inside your own network. The open alternative to Granola, Otter and Fireflies.",
  alternates: { canonical: `${SITE.url}/open-source` },
};

const faqs = [
  ["Is ParleyNotes really open source?", "Yes — the app is released under the permissive MIT licence. You can read it, fork it, audit it and run it yourself, forever, at no cost."],
  ["Where does transcription happen?", "Entirely in your browser. The Whisper speech-to-text model is downloaded once from the Hugging Face CDN and then runs on your device via WebGPU or WebAssembly. Your audio is never sent to a server."],
  ["What's the catch with 'free'?", "There isn't one for individuals. Because the heavy lifting runs on your machine, hosting costs us almost nothing. We charge teams that want a shared workspace, and companies that want SSO, admin controls and a supported self-host bundle."],
  ["Can I self-host it for my company?", "Yes. The code is yours under MIT. A Company license adds a supported Docker/Helm bundle, SSO/SAML, an admin console and an SLA — but you can always self-host the open-source build for free."],
  ["Does a bot join my meeting?", "No. Unlike most notetakers, ParleyNotes captures the meeting tab's audio directly through your browser, so nothing shows up in the participant list."],
];

export default function OpenSource() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  return (
    <main className="mx-auto max-w-3xl px-5 py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1 className="text-3xl font-extrabold tracking-tight">Open source by design</h1>
      <p className="mt-4 text-stone-600">
        Meeting notes are some of the most sensitive data a company produces — strategy, hiring, deals, 1:1s.
        Closed AI notetakers ask you to upload all of it to their cloud. ParleyNotes takes the opposite stance:
        the code is open, and your audio never leaves your device.
      </p>
      <div className="mt-6 flex gap-3">
        <a href={SITE.repo} target="_blank" rel="noreferrer" className="rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-700">View the source on GitHub</a>
        <Link href="/app" className="rounded-xl border border-stone-300 px-5 py-2.5 text-sm font-medium hover:bg-stone-50">Open the app</Link>
      </div>

      <h2 className="mt-12 text-2xl font-bold">FAQ</h2>
      <div className="mt-4 space-y-5">
        {faqs.map(([q, a]) => (
          <div key={q}>
            <h3 className="font-semibold text-stone-900">{q}</h3>
            <p className="mt-1 text-sm text-stone-600">{a}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
