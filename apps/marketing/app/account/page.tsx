import type { Metadata } from "next";
import { Suspense } from "react";
import { SITE } from "@/lib/site";
import { PageHeader, Section } from "@/components/site/Chrome";
import AccountPanel from "@/components/auth/AccountPanel";

export const metadata: Metadata = {
  title: "Your account",
  description: "Manage your Ledgeur plan, billing and agent access tokens.",
  alternates: { canonical: `${SITE.url}/account` },
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <main>
      <PageHeader kicker="Account" title="Your account" />
      <Section width="narrow" className="!py-12">
        {/* AccountPanel reads ?checkout=success, and a client component that
            reads search params has to sit under a Suspense boundary or the page
            cannot be prerendered at all. The fallback is what somebody sees for
            the few milliseconds before hydration. */}
        <Suspense fallback={<p className="text-[14px] text-muted">Loading your account…</p>}>
          <AccountPanel />
        </Suspense>
      </Section>
    </main>
  );
}
