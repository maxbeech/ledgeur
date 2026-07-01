import type { Metadata } from "next";

// OAuth callback landing for the desktop app's Notion connect flow. Notion
// redirects here with ?code=…; the user copies it into the app to finish. This
// page is intentionally noindex and excluded from the sitemap.
export const metadata: Metadata = {
  title: "Connect Notion — ParleyNotes",
  robots: { index: false, follow: false },
};

export default async function NotionCallback({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
  const { code, error } = await searchParams;
  return (
    <main className="mx-auto max-w-xl px-5 py-20 text-center">
      <h1 className="text-2xl font-extrabold tracking-tight">Connect Notion to ParleyNotes</h1>
      {error ? (
        <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          Notion returned an error: {error}. Please try connecting again from the app.
        </p>
      ) : code ? (
        <>
          <p className="mt-4 text-stone-600">
            Copy this code and paste it into ParleyNotes (Integrations → Notion → Finish):
          </p>
          <code className="mt-5 block break-all rounded-xl bg-stone-900 px-4 py-3 text-sm text-emerald-300">
            {code}
          </code>
          <p className="mt-4 text-xs text-stone-500">You can close this tab once the app confirms the connection.</p>
        </>
      ) : (
        <p className="mt-6 text-stone-600">No authorization code was provided. Start the connection from the app.</p>
      )}
    </main>
  );
}
