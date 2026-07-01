import type { Metadata } from "next";
import Link from "next/link";
import { POSTS } from "@/lib/posts";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Guides — AI meeting notes, transcription & privacy",
  description:
    "Guides on AI meeting notes, free meeting transcription, on-device privacy and choosing the right notetaker. From the ParleyNotes team.",
  alternates: { canonical: `${SITE.url}/blog` },
};

export default function BlogIndex() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-3xl font-extrabold tracking-tight">Guides</h1>
      <p className="mt-2 text-stone-600">Practical guides on meeting notes, transcription and keeping your meetings private.</p>
      <div className="mt-8 space-y-3">
        {POSTS.map((p) => (
          <Link key={p.slug} href={`/blog/${p.slug}`} className="block rounded-xl border border-stone-200 bg-white p-5 hover:border-emerald-300">
            <h2 className="font-semibold text-stone-900">{p.title}</h2>
            <p className="mt-1 text-sm text-stone-600">{p.description}</p>
            <div className="mt-2 text-xs text-stone-600">{p.date} · {p.readMins} min read</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
