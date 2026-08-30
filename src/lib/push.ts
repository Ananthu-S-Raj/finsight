import { supabase } from "./supabaseClient";
import { readSettings, type NotificationPrefs } from "./settingsCore";

export type PushPermission =
  | "granted"
  | "denied"
  | "default"
  | "unsupported";

export function currentPermission(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as PushPermission;
}

export function supportsPush(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const VAPID_PLACEHOLDER = "generated-vapid-public-key";

/**
 * Validates the configured VAPID public key before asking the push service for
 * a subscription.
 *
 * A real VAPID public key is a 65-byte URL-safe base64-encoded P-256 point.
 * The placeholder value (`generated-vapid-public-key`) shipped in .env.local
 * is NOT a key — subscribing with it makes the browser's push service reject
 * the application server, which surfaces as the generic "couldn't enable
 * notifications" failure. We detect missing / placeholder / malformed keys up
 * front so the UI can report the real cause instead.
 */
export function isValidVapidKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key === VAPID_PLACEHOLDER || /^generated-vapid/i.test(key)) return false;
  try {
    // VAPID application server keys for web push are 65 bytes (P-256).
    return urlBase64ToUint8Array(key).length === 65;
  } catch {
    return false;
  }
}

/** Lists this device's stored subscription (by endpoint). */
export async function getStoredSubscriptions(userId: string) {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, subscription")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as { id: string; subscription: PushSubscriptionJSON }[];
}

/**
 * Registers this device for web push. Call only after the user has opted in
 * via an in-app control (never spam the browser dialog).
 */
export async function subscribeForPush(
  userId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!supportsPush()) {
    return { ok: false, reason: "unsupported" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: permission };
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    return { ok: false, reason: "missing-vapid" };
  }
  if (!isValidVapidKey(vapidKey)) {
    return { ok: false, reason: "invalid-vapid" };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    // Avoid duplicates — remove any existing subscription for the same endpoint.
    const existing = await getStoredSubscriptions(userId);
    const endpoint = subscription.endpoint;
    for (const row of existing) {
      const raw = (row.subscription as { endpoint?: string } | null)?.endpoint;
      if (raw === endpoint) {
        return { ok: true };
      }
    }

    const { error } = await supabase.from("push_subscriptions").insert({
      user_id: userId,
      subscription: subscription.toJSON(),
      prefs: readSettings().notifications,
    });
    if (error) throw error;
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Syncs notification preferences to every subscription this user owns (one row
 * per device). The server respects these before sending. Safe to call even on
 * deployments without the prefs column.
 */
export async function syncPushPrefs(userId: string, prefs: NotificationPrefs) {
  try {
    await supabase
      .from("push_subscriptions")
      .update({ prefs })
      .eq("user_id", userId);
  } catch {
    // Column may not exist on older deployments — prefs are a refinement, not
    // a requirement; the server still sends privacy-safe reminders.
  }
}

/** Removes this device's subscription (all stored subscriptions on this endpoint). */
export async function unsubscribeFromPush(userId: string) {
  let endpoint: string | null = null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    endpoint = sub?.endpoint ?? null;
    await sub?.unsubscribe();
  } catch {
    // continue — we still clear stored rows below
  }

  const existing = await getStoredSubscriptions(userId);
  const toRemove = existing.filter((row) => {
    const raw = (row.subscription as { endpoint?: string } | null)?.endpoint;
    return endpoint ? raw === endpoint : true;
  });

  for (const row of toRemove) {
    await supabase.from("push_subscriptions").delete().eq("id", row.id);
  }
  return { removed: toRemove.length };
}

/**
 * Whether this device is genuinely registered for push: a browser push
 * subscription exists AND it is persisted server-side. We intentionally do NOT
 * report "registered" from the browser subscription alone — a browser sub whose
 * server row failed to insert (e.g. a DB/persistence error during enable) is not
 * actually usable, so the settings UI must not claim "This device is registered
 * for push" for it.
 */
export async function isSubscribed(userId: string): Promise<boolean> {
  try {
    if (!supportsPush()) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const rows = await getStoredSubscriptions(userId);
    const endpoint = sub.endpoint;
    return rows.some(
      (row) => (row.subscription as { endpoint?: string } | null)?.endpoint === endpoint
    );
  } catch {
    return false;
  }
}


