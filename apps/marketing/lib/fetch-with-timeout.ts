// A fetch that cannot hang the UI. Without a deadline, a request to a third-party
// host that never answers leaves the caller waiting with no error, so the user sees
// nothing happen. This aborts after `ms` and throws a message a person can act on.

export class FetchTimeoutError extends Error {
  constructor(readonly url: string, readonly ms: number) {
    super(`The download did not respond within ${Math.round(ms / 1000)} seconds.`);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  url: string,
  ms: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject before aborting: the abort makes the fetch reject too, and the first
      // settlement wins the race, so the caller must see the timeout, not that echo.
      reject(new FetchTimeoutError(url, ms));
      controller.abort();
    }, ms);
  });
  try {
    // Race the deadline as well as aborting: a fetch implementation that ignores
    // its signal must still not keep the caller waiting past `ms`.
    return await Promise.race([fetchImpl(url, { signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
