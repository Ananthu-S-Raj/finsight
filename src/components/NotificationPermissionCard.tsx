"use client";

import { useEffect, useState } from "react";
import Icon, { type IconName } from "./ui/Icons";
import Button from "./ui/Button";
import { useToast } from "./ui/ToastProvider";
import {
  currentPermission,
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
      } else if (result.reason === "missing-vapid") {
        patchNotifications({ push: true });
        toast.info("Permission granted — push will activate once VAPID keys are configured.");
      } else if (result.reason === "unsupported") {
        patchNotifications({ push: false });
        toast.info("This browser doesn't support notifications.");
      } else {
        toast.warning("Couldn't enable notifications right now.");
      }
    } finally {
      setBusy(false);
    }
  }

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
