import Link from "next/link";
import { SITE, VALUE_PROPS } from "@/lib/site";
import { COMPETITORS } from "@/lib/competitors";
import { USE_CASES } from "@/lib/usecases";
import { PLATFORMS } from "@/lib/platforms";

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="paper-grad">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            Open source · MIT · runs in your browser
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight text-stone-900 sm:text-5xl">
            The open-source AI meeting assistant that keeps your meetings <span className="text-emerald-700">private</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-stone-600">
            Record or upload a meeting and get an instant transcript and structured notes — transcribed
            entirely in your browser with Whisper. No bot joins your call, no audio leaves your device,
            no per-seat fee. The open alternative to Granola and Otter.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/app" className="rounded-xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-600">
              Open the app — free
            </Link>
            <a href={SITE.repo} target="_blank" rel="noreferrer" className="rounded-xl border border-stone-300 px-6 py-3 text-sm font-medium hover:bg-white">
              Star on GitHub
            </a>
          </div>
          <p className="mt-4 text-xs text-stone-600">No sign-up. Works in Chrome, Edge and Brave.</p>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="sr-only">Why ParleyNotes</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE_PROPS.map((v) => (
            <div key={v.title} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-stone-900">{v.title}</h3>
              <p className="mt-2 text-sm text-stone-600">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-5 py-8">
        <h2 className="text-center text-2xl font-bold">How it works</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            ["1. Capture", "Share your meeting tab (with audio) and your mic — or upload an existing recording. Nothing is sent anywhere."],
            ["2. Transcribe on-device", "Whisper runs in your browser via WebGPU/WASM and writes a live transcript as the meeting unfolds."],
            ["3. Get notes", "One click turns the transcript into a summary, decisions and action items. Edit, save locally, or export Markdown."],
          ].map(([t, b]) => (
            <div key={t}>
              <div className="text-sm font-bold text-emerald-700">{t}</div>
              <p className="mt-1 text-sm text-stone-600">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link href="/app" className="rounded-xl bg-stone-900 px-6 py-3 text-sm font-semibold text-white hover:bg-stone-700">Try it now →</Link>
        </div>
      </section>

      {/* Platforms */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-center text-2xl font-bold">Transcribe any meeting</h2>
        <p className="mt-2 text-center text-sm text-stone-600">Works with every browser-based meeting platform.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {PLATFORMS.map((p) => (
            <Link key={p.slug} href={`/transcribe/${p.slug}`} className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm hover:border-emerald-300">
              {p.name}
            </Link>
          ))}
        </div>
      </section>

      {/* Alternatives */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-center text-2xl font-bold">A private, open alternative to closed AI notetakers</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMPETITORS.slice(0, 6).map((c) => (
            <Link key={c.slug} href={`/alternatives/${c.slug}`} className="rounded-xl border border-stone-200 bg-white p-4 hover:border-emerald-300">
              <div className="font-semibold">ParleyNotes vs {c.name}</div>
              <div className="mt-1 text-sm text-stone-600">{c.what}</div>
            </Link>
          ))}
        </div>
        <div className="mt-4 text-center"><Link href="/alternatives" className="text-sm font-medium text-emerald-700 hover:underline">See all alternatives →</Link></div>
      </section>

      {/* Use cases */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-center text-2xl font-bold">Built for every kind of meeting</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {USE_CASES.map((u) => (
            <Link key={u.slug} href={`/use-cases/${u.slug}`} className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm hover:border-emerald-300">
              {u.name}
            </Link>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-5 py-16 text-center">
        <h2 className="text-3xl font-bold">Your meetings, your data.</h2>
        <p className="mx-auto mt-3 max-w-xl text-stone-600">Free forever for individuals. Company licenses add a shared team workspace, SSO and a supported self-host bundle.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/app" className="rounded-xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-600">Open the app</Link>
          <Link href="/pricing" className="rounded-xl border border-stone-300 px-6 py-3 text-sm font-medium hover:bg-white">See pricing</Link>
        </div>
      </section>
    </main>
  );
}
