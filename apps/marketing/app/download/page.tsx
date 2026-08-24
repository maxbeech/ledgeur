import type { Metadata } from "next";
import Link from "next/link";
import { Card, LinkButton, buttonClass } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { SITE } from "@/lib/site";
import {
  assetsFor, fetchLatestRelease, formatBytes, releasesPageUrl,
  type Platform, type ReleaseInfo,
} from "@/lib/downloads";

export const metadata: Metadata = {
  title: "Download",
  description:
    "Download the Ledgeur desktop app for macOS — signed, notarised, and universal for Intel and Apple Silicon. Or use it in the browser with nothing to install.",
  alternates: { canonical: `${SITE.url}/download` },
};

// Next requires this to be a literal it can read statically — an imported
// constant fails the build with "Invalid segment configuration export". The
// value must stay in step with DOWNLOAD_REVALIDATE_SECONDS, which is what the
// fetch below uses; a test asserts the two agree.
export const revalidate = 3600;

/** Platforms in the order we can actually serve them. */
const PLATFORMS: { id: Platform; name: string; requirement: string }[] = [
  { id: "macos", name: "macOS", requirement: "macOS 10.15 Catalina or later" },
  { id: "windows", name: "Windows", requirement: "Windows 10 or later" },
  { id: "linux", name: "Linux", requirement: "A recent x86-64 distribution" },
];

export default async function Download() {
  const release = await fetchLatestRelease();

  return (
    <main>
      <PageHeader
        kicker={release ? `Version ${release.version}` : "Desktop app"}
        title="Download Ledgeur"
        lede={
          <>
            The desktop app records system audio as well as your microphone, so it captures the
            whole call rather than half of it. Everything still runs on your machine.{" "}
            <Link href="/app" className="underline underline-offset-4 hover:text-ink-text">
              Or use it in the browser
            </Link>{" "}
            with nothing to install.
          </>
        }
      />

      <Section width="narrow">
        {release ? <Available release={release} /> : <NotPublishedYet />}
      </Section>

      {release && (
        <Section width="narrow" className="!pt-0">
          <SectionHead
            kicker="Before you ask"
            title="Yes, it will just open."
            lede="A privacy tool that trips Gatekeeper on first launch is asking a lot of trust it has not earned yet."
          />
          <Card className="mt-7 divide-y divide-hairline">
            <Fact
              claim="Signed by Maxed Labs Ltd, and notarised by Apple."
              detail="macOS checks the signature and Apple's notarisation ticket when you open it, so you get the ordinary “downloaded from the internet” prompt rather than a warning that the developer cannot be verified. The ticket is stapled to the download, so the check works offline."
            />
            <Fact
              claim="One download for every Mac."
              detail="The build is universal: the same file runs natively on Apple Silicon and on Intel Macs. Nothing to choose between, and no Rosetta."
            />
            <Fact
              claim="You can read what you are installing."
              detail={
                <>
                  Ledgeur is MIT licensed. The source for this exact release is on{" "}
                  <a href={release.notesUrl} className="underline underline-offset-4">GitHub</a>, and you can
                  build it yourself if you would rather not trust a binary at all.
                </>
              }
            />
          </Card>
        </Section>
      )}
    </main>
  );
}

function Available({ release }: { release: ReleaseInfo }) {
  const published = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {PLATFORMS.map((platform) => {
          const assets = assetsFor(release, platform.id);
          return (
            <Card key={platform.id} className="flex flex-col p-5">
              <h2 className="ldg-display text-[19px] text-ink-text">{platform.name}</h2>
              <p className="mt-1 text-[13px] text-muted">{platform.requirement}</p>

              {assets.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {assets.map((asset) => (
                    <div key={asset.url}>
                      <LinkButton href={asset.url} tone="primary" size="md" className="w-full justify-center">
                        Download for {platform.name}
                      </LinkButton>
                      <p className="mt-1.5 text-center text-[12.5px] text-muted">
                        {asset.label}
                        {asset.sizeBytes ? ` · ${formatBytes(asset.sizeBytes)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                // Saying "coming soon" would be a promise with no date behind it.
                <div className="mt-4 flex flex-1 flex-col justify-end">
                  <p className="text-[13.5px] leading-relaxed text-muted">
                    Not built yet. The app is cross-platform and{" "}
                    <a href={SITE.repo} className="underline underline-offset-4">builds from source</a> on{" "}
                    {platform.name} today — a signed installer is not published.
                  </p>
                  <Link href="/app" className={buttonClass("secondary", "sm", "mt-3 w-full justify-center")}>
                    Use it in the browser
                  </Link>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-[13px] text-muted">
        Version {release.version}
        {published ? `, released ${published}` : ""} ·{" "}
        <a href={release.notesUrl} className="underline underline-offset-4 hover:text-ink-text">
          Release notes
        </a>{" "}
        ·{" "}
        <Link href="/changelog" className="underline underline-offset-4 hover:text-ink-text">
          What changed
        </Link>
      </p>
    </>
  );
}

/** Shown when there is no published release, or GitHub could not be reached.
 *  Both are the same thing from here: there is no file we can honestly offer. */
function NotPublishedYet() {
  return (
    <Card className="p-6 sm:p-8">
      <h2 className="ldg-display text-[22px] text-ink-text">No desktop build published yet</h2>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
        There is no installer to download at the moment. Two things you can do instead — both give
        you the full recorder, transcription and speaker separation.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-[14.5px] font-medium text-ink-text">Use it in your browser</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
            Nothing to install, and the models still run on your machine. The one thing it cannot do
            is capture system audio as reliably as the desktop app.
          </p>
          <Link href="/app" className={buttonClass("primary", "sm", "mt-3")}>Open the app</Link>
        </div>
        <div>
          <h3 className="text-[14.5px] font-medium text-ink-text">Build it from source</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
            Ledgeur is MIT licensed. Clone the repository and run{" "}
            <code className="rounded bg-surface-muted px-1 py-0.5 text-[12.5px]">pnpm --filter @ledgeur/desktop tauri build</code>.
          </p>
          <a href={SITE.repo} className={buttonClass("secondary", "sm", "mt-3")}>View the source</a>
        </div>
      </div>

      <p className="mt-6 text-[13px] text-muted">
        Releases are published{" "}
        <a href={releasesPageUrl()} className="underline underline-offset-4 hover:text-ink-text">on GitHub</a> —
        watch the repository to hear about the first one.
      </p>
    </Card>
  );
}

function Fact({ claim, detail }: { claim: string; detail: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[14.5px] font-medium text-ink-text">{claim}</p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{detail}</p>
    </div>
  );
}
