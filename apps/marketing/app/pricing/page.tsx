import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import CheckoutButton from "@/components/CheckoutButton";

export const metadata: Metadata = {
  title: "Pricing — free for individuals, company licenses for teams",
  description:
    "ParleyNotes is free forever for individuals. Paid Team and Company licenses add a shared workspace, SSO, admin controls and a supported self-host bundle.",
  alternates: { canonical: `${SITE.url}/pricing` },
};

const tiers = [
  {
    name: "Personal",
    price: "$0",
    cadence: "free forever",
    cta: "personal",
    features: ["Unlimited recording & transcription", "On-device Whisper — fully private", "Local AI notes + bring-your-own-key", "Saved meetings & Markdown export", "Every meeting platform"],
  },
  {
    name: "Team",
    price: "$6",
    cadence: "per user / month",
    cta: "team",
    highlight: true,
    features: ["Everything in Personal", "Shared team workspace", "Searchable team library", "Centralised AI key & spend", "Email support", "14-day free trial"],
  },
  {
    name: "Company license",
    price: "Custom",
    cadence: "annual",
    cta: "company",
    features: ["Self-host bundle (Docker + Helm)", "SSO / SAML & SCIM", "Admin console & audit log", "On-prem / air-gapped option", "Priority support & SLA", "Source under MIT — no lock-in"],
  },
];

export default function Pricing() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-14">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Simple, honest pricing</h1>
        <p className="mx-auto mt-3 max-w-2xl text-stone-600">
          The product is free for individuals because it runs on your own device — there’s nothing to pay for.
          Teams pay only when they want to collaborate, and companies pay for self-hosting, SSO and support.
        </p>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {tiers.map((t) => (
          <div key={t.name} className={`rounded-2xl border bg-white p-6 shadow-sm ${t.highlight ? "border-emerald-400 ring-1 ring-emerald-200" : "border-stone-200"}`}>
            {t.highlight && <div className="mb-3 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Most popular</div>}
            <h2 className="text-lg font-bold">{t.name}</h2>
            <div className="mt-2"><span className="text-3xl font-extrabold">{t.price}</span> <span className="text-sm text-stone-600">{t.cadence}</span></div>
            <ul className="mt-5 space-y-2 text-sm text-stone-600">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2"><span className="text-emerald-700">✓</span><span>{f}</span></li>
              ))}
            </ul>
            <div className="mt-6">
              {t.cta === "personal" && <Link href="/app" className="block rounded-xl bg-stone-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-stone-700">Open the app</Link>}
              {t.cta === "team" && <CheckoutButton />}
              {t.cta === "company" && <a href={`mailto:${SITE.contactEmail}?subject=ParleyNotes%20company%20license`} className="block rounded-xl border border-stone-300 px-4 py-2.5 text-center text-sm font-semibold hover:bg-stone-50">Talk to us</a>}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-stone-600">
        Prices in USD. Self-hosting is always free under the MIT licence — a Company license adds SSO, admin tooling and support.
      </p>
    </main>
  );
}
