// The "first free use" of a browser, reported once.
//
// The journey's free_user step is "fire once per person at the first free
// use". On the web a person is a browser, so the mark lives in that browser's
// storage. Pure on purpose: the caller passes the store, so the rule is tested
// without a DOM. See components/app/FirstFreeUse.tsx for the call site.

/** localStorage key recording that this browser has already reported free_user. */
export const FIRST_FREE_USE_KEY = "ledgeur.firstFreeUseReported";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/**
 * True exactly once per store. The first call records the mark and returns
 * true; every later call finds the mark and returns false.
 */
export function claimFirstFreeUse(store: KeyValueStore): boolean {
  if (store.getItem(FIRST_FREE_USE_KEY) === "1") return false;
  store.setItem(FIRST_FREE_USE_KEY, "1");
  return true;
}
