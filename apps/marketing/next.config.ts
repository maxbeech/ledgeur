import type { NextConfig } from "next";

// The transcription Web Worker lives in /public and loads transformers.js from a
// CDN at runtime, so nothing here needs to bundle the ML runtime. We add a long
// cache header for the worker (Vercel edge / Fast Origin Transfer friendly).
// All SEO pages are statically generated.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The worker and the model load plan it imports are versioned together.
        //
        // These two files decide whether transcription works at all, and they
        // are a few KB each — the model weights they pull are cached separately
        // by the Hugging Face CDN. They were previously cached for a day, which
        // meant a broken worker stayed broken for users for up to 24 hours after
        // a fix shipped. Revalidate every time instead: a 304 costs almost
        // nothing, and a fix reaches everyone on their next page load.
        source: "/:file(transcribe.worker.js|asr-plan.js)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        // Baseline security headers on every route. We deliberately do NOT set a
        // restrictive Permissions-Policy here: the app needs same-origin
        // microphone + display-capture (getUserMedia / getDisplayMedia), and the
        // browser default already allows those for same-origin.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
