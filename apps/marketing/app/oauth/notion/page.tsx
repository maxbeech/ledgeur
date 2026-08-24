import type { Metadata } from "next";
import { ErrorNote } from "@ledgeur/ui/components";

// OAuth callback landing for the desktop app's Notion connect flow. Notion
// redirects here with ?code=…; the user copies it into the app to finish. This
// page is intentionally noindex and excluded from the sitemap.
export const metadata: Metadata = {
  title: "Connect Notion",
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
      <h1 className="ldg-display text-[26px] leading-tight text-ink-text">Connect Notion to Ledgeur</h1>
      {error ? (
        <ErrorNote className="mt-6 text-left">
          Notion returned an error: {error}. Try connecting again from the app.
        </ErrorNote>
      ) : code ? (
        <>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            Copy this code and paste it into Ledgeur (Integrations → Notion → Finish):
          </p>
          <code className="mt-5 block break-all rounded-xl bg-ink px-4 py-3 font-mono text-[13px] text-on-ink">
            {code}
          </code>
          <p className="mt-4 text-[12.5px] text-faint">You can close this tab once the app confirms the connection.</p>
        </>
      ) : (
        <p className="mt-6 text-[15px] leading-relaxed text-muted">No authorization code was provided. Start the connection from the app.</p>
      )}
    </main>
  );
}
