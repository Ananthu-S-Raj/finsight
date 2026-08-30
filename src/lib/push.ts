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

/**
 * How long to wait for the service worker to become active before giving up.
 * `navigator.serviceWorker.ready` never rejects — if the worker registration
 * is missing or stuck installing it would otherwise hang the settings UI on an
 * eternal "Enabling…" spinner. A bounded wait lets the UI report a real,
 * actionable failure instead.
 */
export const SW_READY_TIMEOUT_MS = 5000;

const SW_READY_TIMEOUT_ERR = "finsight:sw-not-ready";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(SW_READY_TIMEOUT_ERR)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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

export type VapidIssue = "ok" | "missing" | "invalid";

/**
 * Classifies the configured VAPID public key so the UI can explain WHY push
 * cannot be enabled instead of showing a generic failure.
 */
export function getVapidIssue(): VapidIssue {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return "missing";
  return isValidVapidKey(key) ? "ok" : "invalid";
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
    // "denied" is a hard block; "default" means the prompt was dismissed /
    // not decided yet. Keep them distinct so the UI can say the right thing.
    return { ok: false, reason: permission === "denied" ? "denied" : "default" };
  }

  const vapidIssue = getVapidIssue();
  if (vapidIssue === "missing") {
    return { ok: false, reason: "missing-vapid" };
  }
  if (vapidIssue === "invalid") {
    return { ok: false, reason: "invalid-vapid" };
  }
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string;

  try {
    // Await the active worker with a bound — `ready` never rejects, so without
    // a timeout a failed/never-completing registration would hang the UI.
    const registration = await withTimeout(
      navigator.serviceWorker.ready,
      SW_READY_TIMEOUT_MS
    );
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    // Already registered for this endpoint? Nothing more to persist.
    const endpoint = subscription.endpoint;
    const existing = await getStoredSubscriptions(userId);
    if (
      existing.some(
        (row) => (row.subscription as { endpoint?: string } | null)?.endpoint === endpoint
      )
    ) {
      return { ok: true };
    }

    const { error } = await supabase.from("push_subscriptions").insert({
      user_id: userId,
      subscription: subscription.toJSON(),
      prefs: readSettings().notifications,
    });
    if (error) {
      // A unique-endpoint violation (23505) surfaces when the browser still
      // holds a subscription whose server row was removed (e.g. cleaned up
      // after 410) or two tabs raced. The endpoint already being stored IS a
      // successful registration — re-check before reporting failure.
      if (error.code === "23505" || /duplicate key/i.test(error.message ?? "")) {
        const refetch = await getStoredSubscriptions(userId).catch(() => []);
        if (
          refetch.some(
            (row) => (row.subscription as { endpoint?: string } | null)?.endpoint === endpoint
          )
        ) {
          return { ok: true };
        }
      }
      // Persisting the browser subscription failed — do NOT claim success.
      return { ok: false, reason: "save-failed" };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === SW_READY_TIMEOUT_ERR) {
      return { ok: false, reason: "no-worker" };
    }
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
    const reg = await withTimeout(
      navigator.serviceWorker.ready,
      SW_READY_TIMEOUT_MS
    );
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
    const reg = await withTimeout(
      navigator.serviceWorker.ready,
      SW_READY_TIMEOUT_MS
    );
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

export type SendTestResult = {
  ok: boolean;
  sent: number;
  reason?: "unsupported" | "permission" | "not-subscribed" | "not-configured" | "unauthenticated" | "missing-vapid" | "error";
};

/**
 * Resolves the Supabase Edge Function URL (e.g. .../functions/v1/<name>).
 * Edge functions live on the project's `.functions.supabase.co` host; custom
 * domains do not expose a functions sub-host, so this returns null there.
 */
function edgeFunctionUrl(name: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const host = new URL(base).host;
    if (!host.endsWith(".supabase.co")) return null;
    return `https://${host.replace(/\.supabase\.co$/, ".functions.supabase.co")}/${name}`;
  } catch {
    return null;
  }
}

/**
 * Delivers an instant test push via the `test-notification` Edge Function.
 * The function verifies the caller's JWT and only ever sends to that user's own
 * subscriptions — this just wires the authenticated request through.
 */
export async function sendTestNotification(userId: string): Promise<SendTestResult> {
  if (!supportsPush()) return { ok: false, sent: 0, reason: "unsupported" };
  if (currentPermission() !== "granted") return { ok: false, sent: 0, reason: "permission" };
  if (!(await isSubscribed(userId))) return { ok: false, sent: 0, reason: "not-subscribed" };

  const url = edgeFunctionUrl("test-notification");
  if (!url) return { ok: false, sent: 0, reason: "not-configured" };

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, sent: 0, reason: "unauthenticated" };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    const body = (await res.json().catch(() => ({}))) as {
      sent?: number;
      removed?: number;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        sent: 0,
        reason: body.error === "vapid_not_configured" ? "missing-vapid" : "error",
      };
    }
    return { ok: true, sent: body.sent ?? 0 };
  } catch {
    return { ok: false, sent: 0, reason: "error" };
  }
}


