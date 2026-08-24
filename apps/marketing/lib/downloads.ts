// The desktop build, as published on GitHub Releases.
//
// The binary is not committed to this repo and never should be: a 13 MB DMG per
// release would bloat every clone and every Vercel deployment for a file the CDN
// in front of GitHub Releases already serves. So the page asks GitHub what the
// latest release actually contains, at build time and then on a schedule.
//
// Nothing here invents a download. If there is no published release, or GitHub
// is unreachable, the page says so and offers building from source — it never
// renders a button pointing at a file that may not exist.

import { SITE } from "./site";

/** How long a rendered download page may be stale, in seconds.
 *
 *  The rest of the site revalidates weekly because it only changes when we
 *  deploy. This page changes when a release is published, which happens without
 *  a deploy — an hour is the compromise between "a new version appears on its
 *  own" and "one request per region per hour", well inside GitHub's unauthenticated
 *  rate limit. */
export const DOWNLOAD_REVALIDATE_SECONDS = 3600;

export type Platform = "macos" | "windows" | "linux";

export interface DownloadAsset {
  platform: Platform;
  /** What the file is, in the words someone choosing a download needs. */
  label: string;
  filename: string;
  url: string;
  sizeBytes: number;
}

export interface ReleaseInfo {
  /** "0.2.0" — the tag with any leading v removed. */
  version: string;
  tag: string;
  publishedAt: string;
  notesUrl: string;
  assets: DownloadAsset[];
}

/** owner/repo, derived from the one place the repo URL is defined. */
export function repoPath(repoUrl: string = SITE.repo): string {
  return repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
}

export const latestReleaseApiUrl = () => `https://api.github.com/repos/${repoPath()}/releases/latest`;
export const releasesPageUrl = () => `${SITE.repo}/releases`;

/**
 * What a release asset is, from its filename.
 *
 * Returns null for anything that is not something a person installs — update
 * manifests, detached signatures, source archives. Those are real assets on the
 * release and would otherwise be offered as downloads.
 */
export function classifyAsset(filename: string): { platform: Platform; label: string } | null {
  const name = filename.toLowerCase();

  // Tauri's updater artifacts and their signatures live on the same release.
  if (name.endsWith(".sig") || name.endsWith(".json") || name.endsWith(".txt")) return null;
  if (name.endsWith(".app.tar.gz") || name.endsWith(".app.zip")) return null;

  if (name.endsWith(".dmg")) {
    const arch = name.includes("universal")
      ? "Intel and Apple Silicon"
      : /aarch64|arm64/.test(name)
        ? "Apple Silicon only"
        : /x64|x86_64|intel/.test(name)
          ? "Intel only"
          : "";
    return { platform: "macos", label: arch ? `macOS — ${arch}` : "macOS" };
  }

  if (name.endsWith(".msi") || name.endsWith(".exe")) {
    const arch = /arm64|aarch64/.test(name) ? "Arm" : "x64";
    return { platform: "windows", label: `Windows — ${arch}` };
  }

  if (name.endsWith(".appimage")) return { platform: "linux", label: "Linux — AppImage" };
  if (name.endsWith(".deb")) return { platform: "linux", label: "Linux — Debian/Ubuntu (.deb)" };
  if (name.endsWith(".rpm")) return { platform: "linux", label: "Linux — Fedora/RHEL (.rpm)" };

  return null;
}

/** Shape of the bits of the GitHub release payload we rely on. */
interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

/** Convert a GitHub release payload into what the page renders, or null. */
export function toRelease(payload: unknown): ReleaseInfo | null {
  const r = (payload ?? {}) as GitHubRelease;
  const tag = typeof r.tag_name === "string" ? r.tag_name : "";
  if (!tag) return null;
  // A draft is not published, and a prerelease is not what a download page
  // should hand to someone who just wants the app.
  if (r.draft === true || r.prerelease === true) return null;

  const assets: DownloadAsset[] = (Array.isArray(r.assets) ? r.assets : []).flatMap((raw) => {
    const a = (raw ?? {}) as { name?: unknown; browser_download_url?: unknown; size?: unknown };
    const filename = typeof a.name === "string" ? a.name : "";
    const url = typeof a.browser_download_url === "string" ? a.browser_download_url : "";
    if (!filename || !url) return [];
    const kind = classifyAsset(filename);
    if (!kind) return [];
    return [{
      platform: kind.platform,
      label: kind.label,
      filename,
      url,
      sizeBytes: typeof a.size === "number" ? a.size : 0,
    }];
  });

  if (assets.length === 0) return null;

  return {
    version: tag.replace(/^v/, ""),
    tag,
    publishedAt: typeof r.published_at === "string" ? r.published_at : "",
    notesUrl: typeof r.html_url === "string" ? r.html_url : releasesPageUrl(),
    assets,
  };
}

/**
 * The latest published release, or null when there isn't one we can offer.
 *
 * Never throws: a download page that 500s because GitHub had a bad minute is
 * worse than one that explains there is no build yet.
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(latestReleaseApiUrl(), {
      headers: {
        Accept: "application/vnd.github+json",
        // GitHub rejects requests without one.
        "User-Agent": `${SITE.name}-site`,
      },
      next: { revalidate: DOWNLOAD_REVALIDATE_SECONDS },
    });
    // 404 is the normal answer before the first release is published.
    if (!res.ok) return null;
    return toRelease(await res.json());
  } catch {
    return null;
  }
}

/** Assets for one platform, best first (universal before single-architecture). */
export function assetsFor(release: ReleaseInfo | null, platform: Platform): DownloadAsset[] {
  if (!release) return [];
  return release.assets
    .filter((a) => a.platform === platform)
    .sort((a, b) => Number(b.label.includes("Intel and Apple Silicon")) - Number(a.label.includes("Intel and Apple Silicon")));
}

/** "13.2 MB" — sized for a human deciding whether to wait for it. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${Math.round(bytes / 1000)} KB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
