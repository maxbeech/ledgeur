import type { Metadata } from "next";
import { Suspense } from "react";
import { SITE } from "@/lib/site";
import SignInForm from "@/components/auth/SignInForm";
import { PageHeader, Section } from "@/components/site/Chrome";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Ledgeur to sync your meetings across devices and open them to your AI agents. Recording and transcription work without an account.",
  alternates: { canonical: `${SITE.url}/signin` },
  // Nothing here is worth a search result, and the page is behind a form.
  robots: { index: false, follow: true },
};

export default function SignInPage() {
  return (
    <main>
      <PageHeader
        kicker="Account"
        title="Sign in"
        lede="You do not need an account to record, transcribe or read your meetings — that all works offline. An account adds sync across your devices, the shared team library, and agent access."
      />
      <Section width="prose" className="!py-14">
        {/* SignInForm reads ?next=, so it needs a Suspense boundary to stay
            statically prerenderable. */}
        <Suspense fallback={<p className="text-[14px] text-muted">Loading…</p>}>
          <SignInForm />
        </Suspense>
      </Section>
    </main>
  );
}
