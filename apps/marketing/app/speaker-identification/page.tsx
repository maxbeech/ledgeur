import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { Badge, Card, Label } from "@ledgeur/ui/components";
import { PageHeader, Section, SectionHead } from "@/components/site/Chrome";
import { TranscriptPreview } from "@/components/site/TranscriptPreview";
import { CtaBlock } from "@/components/site/CtaBlock";

export const metadata: Metadata = {
  title: "Speaker diarization and speaker ID, entirely on your device",
  description:
    "How Ledgeur works out who said what: pyannote and WeSpeaker running in your browser, plus voice prints that recognise a person in every later meeting.",
  alternates: { canonical: `${SITE.url}/speaker-identification` },
};

export const revalidate = 604800;

/** The two models, named. A technical reader wants the model, not an adjective. */
const MODELS = [
  {
    stage: "Segmentation",
    model: "pyannote/segmentation-3.0",
    answers: "Where does the voice change?",
    detail:
      "Handles up to three people talking at once, which matters because overlap is where naive approaches produce a transcript that attributes half a sentence to the wrong person.",
  },
  {
    stage: "Embedding",
    model: "WeSpeaker VoxCeleb ResNet34-LM",
    answers: "What does this stretch of speech sound like, as a vector?",
    detail:
      "A 256-number fingerprint of a voice. Comparing two of them answers whether two stretches of audio are the same person, without either of them being labelled.",
  },
  {
    stage: "Clustering",
    model: "Pure TypeScript, in packages/core/src/diarize",
    answers: "Which of these vectors are the same person?",
    detail:
      "The deciding is not a model at all, which is why it is unit-tested without a browser and shared by the live and imported paths. It runs once over the whole meeting, because 'is this the same person' cannot be answered twenty seconds at a time.",
  },
] as const;

export default function SpeakerIdentification() {
  return (
    <main>
      <PageHeader
        kicker="Speaker diarization"
        title="Working out who said what, without the audio leaving your machine."
        lede="Diarization is the part of transcription that turns a wall of text into a record you can act on. Almost every product that does it does it in a cloud. Ledgeur does it in your browser, with two open models and about two hundred lines of arithmetic."
      />

      <Section width="narrow" pad="tight">
        <TranscriptPreview className="ldg-rise" />
      </Section>

      <Section width="narrow">
        <SectionHead
          kicker="The pipeline"
          title="Three stages, two models, no upload."
          lede="Both models are ONNX, both run through WebGPU where there is one and the CPU where there is not, and both are cached after the first run so it works with the wifi off."
        />
        <Card className="mt-8 divide-y divide-hairline">
          {MODELS.map((m) => (
            <div key={m.stage} className="px-5 py-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-base font-semibold text-ink-text">{m.stage}</span>
                <code className="font-mono text-sm text-brand-strong">{m.model}</code>
              </div>
              <p className="mt-2 text-base font-medium text-ink-text">{m.answers}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{m.detail}</p>
            </div>
          ))}
        </Card>
      </Section>

      <Section tint width="narrow">
        <SectionHead
          kicker="What separation alone does not give you"
          title="Speaker 2 is useful exactly once."
          lede="Diarization tells you there were four people. It does not tell you which one was Priya, and a transcript full of Speaker 3 is a transcript nobody searches."
        />
        <div className="mt-7 space-y-4 text-md leading-relaxed text-muted">
          <p>
            So Ledgeur keeps the voice print. Rename Speaker 2 to Priya once, and her fingerprint is
            saved under that name. Next Tuesday she speaks, the print matches, and the transcript
            says Priya before you have read a line of it. Each meeting refines the print as a
            running average, so one bad headset does not undo ten good recordings.
          </p>
          <p>
            Voice prints live in your browser&rsquo;s own storage and are{" "}
            <strong className="font-medium text-ink-text">never synced</strong>, not even on the paid
            plan. A voice print identifies a person after the transcript has been deleted, which
            makes it the most sensitive thing the product holds, so it stays where it was made. That
            is asserted by a test, not just by this paragraph.
          </p>
        </div>
      </Section>

      <Section width="narrow">
        <SectionHead
          kicker="Naming, without guessing"
          title="Meetings usually say who is in them."
          lede="Somebody introduces themselves, or answers to their name. When a recording finishes, the on-device model reads the transcript and names the voices it can prove."
        />
        <div className="mt-7 space-y-4 text-md leading-relaxed text-muted">
          <p>
            There is deliberately no pattern-matching here. A regular expression pulling &ldquo;I&rsquo;m
            X&rdquo; out of a transcript cannot tell &ldquo;I&rsquo;m Max&rdquo; from &ldquo;I&rsquo;m
            afraid not&rdquo;, and a wrong name propagates into every later meeting through the voice
            store. So the model proposes and a validator throws out anything it cannot check.
          </p>
          <ul className="space-y-2.5">
            {[
              "The name has to actually be spoken in the transcript.",
              "The quoted evidence has to be a real line, and the line that says the name.",
              "It has to clear a belief threshold: 0.75 to put a label on, 0.85 to teach the voice.",
              "One name per voice, one voice per name.",
            ].map((rule) => (
              <li key={rule} className="flex gap-3">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
          <p>
            Every name that survives is shown as a guess, with the belief and the words it came from,
            everywhere it appears. Correcting one also un-teaches whatever it taught the voice store,
            so a wrong name cannot quietly become the truth.
          </p>
        </div>
        <div className="mt-7 flex flex-wrap gap-2">
          <Badge>pyannote segmentation 3.0</Badge>
          <Badge>WeSpeaker ResNet34</Badge>
          <Badge tone="accent">Runs on your device</Badge>
          <Badge tone="brand">MIT source</Badge>
        </div>
      </Section>

      <Section tint width="narrow">
        <SectionHead title="How this compares" />
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-base">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="py-3 pr-4 font-medium text-faint">&nbsp;</th>
                <th className="py-3 pr-4 font-medium text-faint">Ledgeur</th>
                <th className="py-3 font-medium text-faint">A hosted notetaker</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Where diarization runs", "Your browser", "The vendor's servers"],
                ["Where the voice print lives", "Your device, never synced", "Their account, if it exists at all"],
                ["Cost per hour of audio", "Your CPU", "Metered minutes"],
                ["Whether you can check", "MIT source, open the network tab", "A privacy policy"],
              ].map(([point, us, them]) => (
                <tr key={point} className="border-b border-hairline last:border-0">
                  <td className="py-3 pr-4 font-medium text-ink-text">{point}</td>
                  <td className="py-3 pr-4 text-muted">{us}</td>
                  <td className="py-3 text-muted">{them}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-sm text-faint">
          <Label as="span" className="mr-2">Read next</Label>
          <Link href="/blog/whisper-in-the-browser-explained" className="font-medium text-brand-strong hover:underline">
            How Whisper runs in a browser tab
          </Link>
        </p>
      </Section>

      <Section width="narrow" pad="tight">
        <CtaBlock
          title="Try it on a recording you already have"
          body="Drag in a voice memo, a Zoom export, an old interview. It is treated exactly like a live meeting, and nothing is uploaded."
        />
      </Section>
    </main>
  );
}
