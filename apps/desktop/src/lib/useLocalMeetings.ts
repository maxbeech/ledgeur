import { useCallback, useEffect, useState } from "react";
import { listMeetings, type LocalMeeting } from "./meetingsStore.ts";

export function useLocalMeetings() {
  const [meetings, setMeetings] = useState<LocalMeeting[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    listMeetings()
      .then(setMeetings)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { meetings, error, refresh };
}
