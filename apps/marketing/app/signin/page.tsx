import type { Metadata } from "next";
import { Suspense } from "react";
import { SITE } from "@/lib/site";
import SignInForm from "@/components/auth/SignInForm";
import { Display } from "@ledgeur/ui/components";

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
    <main className="mx-auto max-w-md px-5 py-14 sm:py-20">
      <div className="mb-8 text-center">
        <Display level={1} className="text-3xl">Sign in</Display>
        <p className="mt-3 text-base leading-relaxed text-muted">
          You do not need an account to record, transcribe or read your meetings. An account adds sync
          across your devices, the shared team library, and agent access.
        </p>
      </div>
      {/* SignInForm reads ?next=, so it needs a Suspense boundary to stay
          statically prerenderable. */}
      <Suspense fallback={<p className="text-center text-base text-muted">Loading</p>}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
