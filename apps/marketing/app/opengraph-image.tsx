import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

// Generated Open Graph / social-share image (1200×630). Uses next/og (built in,
// no extra dependency). Single source of truth is SITE.
export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#faf7f2",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "#059669", color: "#fff", fontSize: 40, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>P</div>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#1c1917" }}>ParleyNotes</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 64, fontWeight: 800, color: "#1c1917", lineHeight: 1.1, maxWidth: 900, display: "flex" }}>
          Open-source AI meeting notes that stay private.
        </div>
        <div style={{ marginTop: 28, fontSize: 30, color: "#57534e", maxWidth: 950 }}>
          Record or upload a meeting → on-device Whisper transcript + notes. No bot, no cloud, free for individuals.
        </div>
      </div>
    ),
    { ...size },
  );
}
