import type { Metadata } from "next";
import Recorder from "@/components/Recorder";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "ParleyNotes app — record, transcribe & summarise meetings privately",
  description:
    "The ParleyNotes web app. Record a meeting or upload audio, get an on-device transcript and AI notes. Nothing is uploaded — everything runs in your browser.",
  alternates: { canonical: `${SITE.url}/app` },
};

export default function AppPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Meeting notes</h1>
        <p className="mt-1 text-sm text-stone-600">
          Everything below runs locally in your browser. The first recording downloads the Whisper model once
          (then it’s cached); your audio is never uploaded.
        </p>
      </div>
      <Recorder />
    </main>
  );
}
