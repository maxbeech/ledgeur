// Which kind of device this is, for layout decisions.
//
// Two questions, kept apart because they have different answers:
//
//   phone   — is this a phone-shaped screen? True in the iOS and Android
//             shells, and in a narrow browser window. Decides bottom tabs vs a
//             sidebar, sheets vs panels, large titles vs page headers.
//   native  — is there a Rust side? True in every Tauri shell, including the
//             phones. Decides system-audio capture, notifications, webhooks.
//
// A phone-sized desktop window gets the phone layout, which is the honest
// thing to do with 380 pixels — and it is what lets the phone shell be
// exercised in a browser during development.

import { useSyncExternalStore } from "react";
import { guessPlatform, isTauri, type Platform } from "./runtime.ts";

const PHONE_QUERY = "(max-width: 767px)";

export interface DeviceInfo {
  phone: boolean;
  native: boolean;
  os: Platform;
}

function mediaMatches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE_QUERY).matches
    : false;
}

let cached: DeviceInfo | null = null;
function snapshot(): DeviceInfo {
  const os = guessPlatform();
  const phone = os === "ios" || os === "android" || mediaMatches();
  const native = isTauri();
  if (cached && cached.phone === phone && cached.native === native && cached.os === os) return cached;
  cached = { phone, native, os };
  return cached;
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** The device, live: a window dragged narrow becomes a phone. */
export function useDevice(): DeviceInfo {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** True when the OS itself is a phone OS — not merely a narrow window. */
export function isPhoneOs(): boolean {
  const os = guessPlatform();
  return os === "ios" || os === "android";
}
