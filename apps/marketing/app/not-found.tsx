import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-5 py-24 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-700 text-lg font-bold text-white">P</div>
      <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-stone-900">Page not found</h1>
      <p className="mt-3 text-stone-600">
        That page doesn’t exist. But your next meeting’s notes are one click away — free, private and on-device.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/app" className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600">Open the app</Link>
        <Link href="/" className="rounded-xl border border-stone-300 px-5 py-2.5 text-sm font-medium hover:bg-stone-50">Back home</Link>
      </div>
      <div className="mt-8 text-sm text-stone-600">
        <Link href="/transcribe" className="hover:text-stone-900">Transcribe</Link> ·{" "}
        <Link href="/alternatives" className="hover:text-stone-900">Alternatives</Link> ·{" "}
        <Link href="/blog" className="hover:text-stone-900">Guides</Link>
      </div>
    </main>
  );
}
