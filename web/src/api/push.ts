/**
 * Notifications on this browser (Web Push). The service worker (public/sw.js)
 * shows what arrives; the backend keeps the subscription on the person and
 * pushes each notice beside its SMS and email (services/notify/push.py).
 */
import { api } from "./client";

export type PushState = "unsupported" | "blocked" | "off" | "on";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "===".slice((base64url.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const registration = () => navigator.serviceWorker.register("/sw.js");

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const found = await (await registration()).pushManager.getSubscription();
  return found ? "on" : "off";
}

/** Ask the browser, subscribe, and hand the subscription to Atria. */
export async function turnPushOn(): Promise<PushState> {
  const { publicKey } = await api<{ publicKey: string | null }>("/me/push");
  if (!publicKey) throw new Error("Notifications are not set up for this hospital yet.");
  const allowed = await Notification.requestPermission();
  if (allowed !== "granted") return allowed === "denied" ? "blocked" : "off";
  const reg = await registration();
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api("/me/push", { method: "POST", json: { ...subscription.toJSON(), label: navigator.userAgent.slice(0, 80) } });
  return "on";
}

export async function turnPushOff(): Promise<PushState> {
  const subscription = await (await registration()).pushManager.getSubscription();
  if (subscription) {
    await api("/me/push", { method: "DELETE", json: { endpoint: subscription.endpoint } });
    await subscription.unsubscribe();
  }
  return "off";
}
