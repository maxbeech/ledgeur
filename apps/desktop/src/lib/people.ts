// The people directory, wired to this device's data.
//
// The counting itself is pure and lives in directory.ts; this reads the two
// stores it needs (meetings, voice profiles) and reports failures honestly.

import { useEffect, useState } from "react";
import { listMeetings } from "./meetingsStore.ts";
import { listProfiles } from "./voiceProfiles.ts";
import { buildDirectory, type Directory } from "./directory.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("people");

export type { Person, Directory } from "./directory.ts";
export { buildDirectory } from "./directory.ts";

export function usePeople(): { directory: Directory | null; error: string } {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const meetings = await listMeetings();
        // An unavailable voice store is not a reason to have no directory —
        // it only means nobody shows as recognised.
        const profiles = await listProfiles().catch((e) => {
          log.warn("voice profiles unavailable for the directory", e);
          return [];
        });
        if (live) setDirectory(buildDirectory(meetings, profiles.map((p) => p.name)));
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { live = false; };
  }, []);

  return { directory, error };
}
