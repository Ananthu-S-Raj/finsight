"use client";

import { useEffect, useState } from "react";
import Icon, { type IconName } from "./ui/Icons";
import Button from "./ui/Button";
import { useToast } from "./ui/ToastProvider";
import {
  currentPermission,
  getVapidIssue,
  isSubscribed,
  subscribeForPush,
  type PushPermission,
} from "@/lib/push";
import { useSettings } from "@/lib/settings";
import { haptic } from "@/lib/haptics";

const PERKS: { icon: IconName; text: string }[] = [
  { icon: "budgets", text: "Budget alerts" },
  { icon: "card", text: "Credit card reminders" },
  { icon: "calendar", text: "Daily expense reminders" },
  { icon: "piggy", text: "Savings reminders" },
];

export default function NotificationPermissionCard({ userId }: { userId: string }) {
  const toast = useToast();
  const { settings, patchNotifications } = useSettings();
  const [permission, setPermission] = useState<PushPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPermission(currentPermission());
    isSubscribed(userId).then(setSubscribed).catch(() => setSubscribed(false));
  }, [userId]);

  const pushEnabled = settings.notifications.push && permission === "granted" && subscribed;

  async function enable() {
    setBusy(true);
    try {
      const result = await subscribeForPush(userId);
      if (result.ok) {
        patchNotifications({ push: true });
        setPermission("granted");
        setSubscribed(true);
        haptic("success");
        toast.success("Notifications enabled.");
      } else if (result.reason === "denied") {
        setPermission("denied");
        patchNotifications({ push: false });
        toast.info("Notifications are blocked. Enable them in your browser site settings.");
      } else if (result.reason === "default") {
        // Prompt dismissed / not decided yet — keep the pref OFF.
        patchNotifications({ push: false });
        toast.info("Notifications are pending — tap “Enable” and choose Allow in the prompt.");
      } else if (result.reason === "missing-vapid") {
        // Permission was granted, but the app has no VAPID public key to
        // subscribe with. Keep the pref OFF — nothing is registered yet.
        patchNotifications({ push: false });
        toast.info("Push notifications are not configured on this deployment yet.");
      } else if (result.reason === "invalid-vapid") {
        patchNotifications({ push: false });
        toast.warning("Push is misconfigured (invalid VAPID key). Please contact support.");
      } else if (result.reason === "no-worker") {
        // A push subscription needs an active service worker; if it wasn't
        // ready in time, the app service worker is still initialising.
        patchNotifications({ push: false });
        toast.info("Unable to register the notification service — reload the app and try again.");
      } else if (result.reason === "save-failed") {
        patchNotifications({ push: false });
        toast.warning("Unable to save your notification subscription. Please try again.");
      } else if (result.reason === "unsupported") {
        patchNotifications({ push: false });
        toast.info("This browser doesn't support notifications.");
      } else {
        patchNotifications({ push: false });
        toast.warning("Couldn't enable notifications right now.");
      }
    } finally {
      setBusy(false);
    }
  }

  const vapidReady = getVapidIssue() === "ok";

  if (pushEnabled) return null;

  return (
    <div className="glass rounded-2xl p-5 animate-fade-up">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#6366f11a", color: "#6366f1" }}>
          <Icon name="bell" size={20} />
        </span>
        <div>
          <h3 className="font-semibold text-snow">Enable FinSight notifications</h3>
          <p className="text-sm text-slate mt-0.5">
            Gentle nudges so you never lose track of your money.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-4">
        {PERKS.map((p) => (
          <div key={p.text} className="flex items-center gap-2 text-[13px] text-frost rounded-xl px-3 py-2 neo-inset">
            <Icon name={p.icon} size={14} className="text-accent shrink-0" />
            {p.text}
          </div>
        ))}
      </div>

      {!vapidReady && permission !== "denied" && (
        <p className="mt-4 text-sm text-warn flex items-start gap-2">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          Push can&apos;t be activated yet — the app isn&apos;t configured with a valid
          VAPID key.
        </p>
      )}

      {permission === "denied" ? (
        <p className="mt-4 text-sm text-warn flex items-start gap-2">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          Notifications are blocked. Open Settings → Notifications, then enable
          them for FinSight in your browser site permissions.
        </p>
      ) : (
        <Button variant="primary" full onClick={enable} disabled={busy} icon="bell" className="mt-4">
          {busy ? "Enabling…" : "Enable notifications"}
        </Button>
      )}
    </div>
  );
}
