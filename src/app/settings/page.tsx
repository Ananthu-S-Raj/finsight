"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Toggle from "@/components/ui/Toggle";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icons";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/ToastProvider";
import { useRequireAuth } from "@/lib/useAuth";
import { usePageData } from "@/lib/usePageData";
import { useSettings, type ThemeMode } from "@/lib/settings";
import { currentPermission, getVapidIssue, isSubscribed, sendTestNotification, subscribeForPush, syncPushPrefs, unsubscribeFromPush, supportsPush } from "@/lib/push";
import { supabase } from "@/lib/supabaseClient";
import { haptic } from "@/lib/haptics";
import PasswordStrength from "@/components/PasswordStrength";
import { setDateOfBirth } from "@/lib/finance";

function SettingRow({
  icon,
  color,
  title,
  hint,
  children,
}: {
  icon: IconName;
  color: string;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-4">
      <span className="h-10 w-10 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}>
        <Icon name={icon} size={18} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-snow">{title}</p>
        {hint && <p className="text-[13px] text-slate mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function SettingsPage() {
  const userId = useRequireAuth();
  const { profile, loading, refresh } = usePageData(userId);
  const { settings, ready, patch, patchNotifications } = useSettings();
  const toast = useToast();
  const router = useRouter();
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState(currentPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState("");
  const [changeDone, setChangeDone] = useState(false);

  const [dobValue, setDobValue] = useState("");
  const [dobBusy, setDobBusy] = useState(false);
  const [dobDone, setDobDone] = useState(false);
  const [dobError, setDobError] = useState("");

  useEffect(() => {
    document.title = "Settings · FinSight";
  }, []);

  const refreshPush = useCallback(async () => {
    if (!userId) return;
    setPermission(currentPermission());
    const sub = await isSubscribed(userId).catch(() => false);
    setSubscribed(sub);
  }, [userId]);

  useEffect(() => {
    refreshPush();
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", onInstalled);
    setInstalled(
      typeof window !== "undefined" &&
        Boolean(window.matchMedia("(display-mode: standalone)").matches)
    );
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [refreshPush]);

  // Keep the server's per-device subscription prefs in sync with what the user
  // picks here, so the daily-reminder function honors their choices.
  useEffect(() => {
    if (!ready || !userId || !settings.notifications.push) return;
    syncPushPrefs(userId, settings.notifications).catch(() => {});
  }, [ready, userId, settings.notifications, settings.notifications.push]);

  // Initialise DOB field from the fetched profile.
  useEffect(() => {
    if (profile) setDobValue(profile.date_of_birth ?? "");
  }, [profile]);

  async function saveDob() {
    if (!userId) return;
    setDobError("");
    setDobDone(false);
    if (dobValue) {
      const d = new Date(dobValue);
      if (isNaN(d.getTime()) || d > new Date()) {
        setDobError("Date of birth cannot be in the future.");
        return;
      }
    }
    setDobBusy(true);
    try {
      await setDateOfBirth(userId, dobValue || null);
      await refresh(userId);
      setDobDone(true);
      haptic("success");
      toast.success(dobValue ? "Date of birth saved." : "Date of birth cleared.");
    } catch {
      setDobError("Couldn't save that right now. Please try again.");
    } finally {
      setDobBusy(false);
    }
  }

  async function togglePush(on: boolean) {
    if (!userId) return;
    if (on) {
      if (!supportsPush()) {
        toast.info("This browser doesn't support notifications.");
        return;
      }
      setPushBusy(true);
      const result = await subscribeForPush(userId);
      setPushBusy(false);
      if (result.ok) {
        patchNotifications({ push: true });
        toast.success("Notifications enabled.");
        refreshPush();
        return;
      }
      // Registration failed — never claim the device is enabled/registered.
      patchNotifications({ push: false });
      if (result.reason === "denied") {
        toast.info("Notifications are blocked. Enable them in your browser site settings.");
      } else if (result.reason === "default") {
        toast.info("Notifications are pending — choose “Allow” in the browser prompt.");
      } else if (result.reason === "missing-vapid") {
        toast.info("Push notifications are not configured on this deployment yet.");
      } else if (result.reason === "invalid-vapid") {
        toast.warning("Push is misconfigured (invalid VAPID key). Please contact support.");
      } else if (result.reason === "no-worker") {
        toast.info("Unable to register the notification service — reload the app and try again.");
      } else if (result.reason === "save-failed") {
        toast.warning("Unable to save your notification subscription. Please try again.");
      } else {
        toast.warning("Couldn't enable notifications right now. Your browser declined the subscription.");
      }
      refreshPush();
    } else {
      setPushBusy(true);
      await unsubscribeFromPush(userId);
      setPushBusy(false);
      patchNotifications({ push: false });
      toast.success("Notifications disabled.");
      refreshPush();
    }
  }

  async function sendTest() {
    if (!userId) return;
    setTestBusy(true);
    try {
      const result = await sendTestNotification(userId);
      if (result.ok) {
        haptic("success");
        toast.success("Test notification sent.");
      } else if (result.reason === "not-subscribed") {
        toast.info("This device isn't registered for push yet.");
      } else if (result.reason === "permission") {
        toast.info("Grant notification permission before sending a test.");
      } else if (result.reason === "missing-vapid") {
        toast.warning("Push isn't configured server-side — VAPID keys are missing.");
      } else {
        toast.warning("Couldn't send a test notification right now.");
      }
    } finally {
      setTestBusy(false);
    }
  }

  async function install() {
    if (installPrompt) {
      setInstallBusy(true);
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallBusy(false);
      if (choice.outcome === "accepted") {
        setInstalled(true);
        toast.success("FinSight installed.");
      }
      setInstallPrompt(null);
    } else {
      toast.info("Use your browser menu → “Install app” to install FinSight.");
    }
  }

  async function logout() {
    haptic("toggle");
    await supabase.auth.signOut();
    toast.info("Signed out. See you soon.");
    router.push("/login");
  }

  async function changePassword() {
    setChangeError("");
    setChangeDone(false);
    if (newPassword !== confirmPassword) {
      setChangeError("New passwords don't match.");
      return;
    }
    setChangeBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setChangeError("You need to be signed in to change your password.");
        return;
      }
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; message?: string };
      if (!res.ok) {
        if (res.status === 401) {
          setChangeError("Your session has expired. Please log in again.");
          return;
        }
        setChangeError(body.error ?? "Couldn't change your password. Please try again.");
        return;
      }

      // The password change invalidated every session issued before now,
      // including this device's. Sign back in with the new password so this
      // device stays logged in (all other devices are signed out).
      if (profile?.email) {
        const { error: reauthError } = await supabase.auth.signInWithPassword({
          email: profile.email,
          password: newPassword,
        });
        if (reauthError) {
          await supabase.auth.signOut();
          toast.success(body.message ?? "Password changed. Please log in again.");
          router.push("/login");
          return;
        }
      }

      setChangeDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      haptic("success");
      toast.success(body.message ?? "Password changed successfully.");
    } catch {
      setChangeError("Couldn't reach FinSight right now. Please try again.");
    } finally {
      setChangeBusy(false);
    }
  }

  return (
    <AppShell userId={userId ?? ""} profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}>
      <PageHeader title="Settings" subtitle="Make FinSight yours." icon="settings" />

      {!ready || (loading && !profile) ? (
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass rounded-2xl p-5 space-y-3 animate-pulse-soft">
              <div className="h-3 w-24 rounded bg-tint-hi" />
              <div className="h-3 w-40 rounded bg-tint" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4 animate-fade-up">
          {/* Appearance */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="sun" size={15} className="text-warn" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">Appearance</h2>
            </div>
            <div className="px-5 py-3">
              <p className="text-sm font-semibold text-snow mb-2">Theme</p>
              <SegmentedControl<ThemeMode>
                value={settings.theme}
                label="Theme"
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "System" },
                ]}
                onChange={(v) => {
                  haptic("light");
                  patch({ theme: v });
                }}
              />
            </div>
            <div className="border-t border-line">
              <SettingRow icon="shield" color="#6366f1" title="Reduce motion" hint="Minimize animations and transitions.">
                <Toggle on={settings.reduceMotion} onChange={(v) => patch({ reduceMotion: v })} label="Reduce motion" />
              </SettingRow>
            </div>
          </GlassCard>

          {/* Profile */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="profile" color="#10b981" size={15} />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">Profile</h2>
            </div>
            <div className="border-t border-line">
              <div className="px-5 py-4 space-y-3">
                {dobDone && (
                  <p className="text-sm flex items-center gap-2 text-[#10b981]">
                    <Icon name="check" size={15} /> Date of birth updated.
                  </p>
                )}
                {dobError && (
                  <p className="text-sm flex items-start gap-2 text-danger">
                    <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {dobError}
                  </p>
                )}
                <label className="block">
                  <span className="block text-sm text-slate mb-1">Date of birth</span>
                  <input
                    type="date"
                    value={dobValue}
                    onChange={(e) => {
                      setDobValue(e.target.value);
                      setDobDone(false);
                      setDobError("");
                    }}
                    className="field"
                    max={new Date().toISOString().split("T")[0]}
                    autoComplete="bday"
                  />
                </label>
                <Button
                  variant="primary"
                  full
                  onClick={saveDob}
                  disabled={dobBusy || dobValue === (profile?.date_of_birth ?? "")}
                  icon={dobBusy ? undefined : "check"}
                >
                  {dobBusy ? "Saving…" : "Save date of birth"}
                </Button>
                <p className="text-[12px] leading-relaxed text-muted">
                  {profile?.date_of_birth
                    ? "Your birthday greeting will appear on your special day."
                    : "Set your birthday to get a greeting on your special day."}
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Notifications & Feedback */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="bell" size={15} className="text-accent" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">Notifications &amp; Feedback</h2>
            </div>
            <div className="border-t border-line">
              <SettingRow
                icon="bell"
                color="#10b981"
                title="Push notifications"
                hint={
                  subscribed
                    ? "This device is registered for push."
                    : permission === "denied"
                      ? "Blocked in your browser — re-enable in site settings."
                      : "Budget alerts, reminders and more."
                }
              >
                <Toggle on={subscribed} onChange={togglePush} disabled={pushBusy} label="Push notifications" />
              </SettingRow>
              {subscribed && (
                <div className="border-t border-line px-5 py-3">
                  <Button variant="ghost" full icon="bell" onClick={sendTest} disabled={testBusy}>
                    {testBusy ? "Sending…" : "Send test notification"}
                  </Button>
                  <p className="text-[12px] text-muted mt-2 text-center">
                    Delivered instantly to every device you registered.
                  </p>
                </div>
              )}
              {!subscribed && getVapidIssue() !== "ok" && permission !== "denied" && (
                <div className="border-t border-line px-5 py-3">
                  <p className="text-[13px] text-warn flex items-start gap-2">
                    <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                    Push can&apos;t be enabled yet — the app needs a valid VAPID key configured.
                  </p>
                </div>
              )}
              <SettingRow icon="budgets" color="#f59e0b" title="Budget alerts" hint="Warn before you go over budget.">
                <Toggle on={settings.notifications.budgetAlerts} onChange={(v) => patchNotifications({ budgetAlerts: v })} label="Budget alerts" />
              </SettingRow>
              <SettingRow icon="calendar" color="#6366f1" title="Daily reminders" hint="A gentle nudge to log your spending.">
                <Toggle on={settings.notifications.dailyReminders} onChange={(v) => patchNotifications({ dailyReminders: v })} label="Daily reminders" />
              </SettingRow>
              <SettingRow icon="card" color="#f59e0b" title="Credit card reminders" hint="Keep an eye on card charges.">
                <Toggle on={settings.notifications.cardReminders} onChange={(v) => patchNotifications({ cardReminders: v })} label="Credit card reminders" />
              </SettingRow>
              <SettingRow icon="coins" color="#10b981" title="Loan reminders" hint="Remember who you owe and who owes you.">
                <Toggle on={settings.notifications.loanReminders} onChange={(v) => patchNotifications({ loanReminders: v })} label="Loan reminders" />
              </SettingRow>
              <SettingRow icon="piggy" color="#eab308" title="Savings notifications" hint="Celebrate savings milestones.">
                <Toggle on={settings.notifications.savingsNotifications} onChange={(v) => patchNotifications({ savingsNotifications: v })} label="Savings notifications" />
              </SettingRow>
              <SettingRow icon="calendar" color="#f59e0b" title="Bill reminders" hint="Remind you before bills are due.">
                <Toggle on={settings.notifications.billReminders} onChange={(v) => patchNotifications({ billReminders: v })} label="Bill reminders" />
              </SettingRow>
              <SettingRow icon="target" color="#6366f1" title="Goal reminders" hint="Nudge you before goal deadlines.">
                <Toggle on={settings.notifications.goalReminders} onChange={(v) => patchNotifications({ goalReminders: v })} label="Goal reminders" />
              </SettingRow>
            </div>
            <div className="border-t border-line">
              <SettingRow icon="volume" color="#6366f1" title="Sound effects" hint="Short, subtle sounds when you save money.">
                <Toggle on={settings.soundEffects} onChange={(v) => patch({ soundEffects: v })} label="Sound effects" />
              </SettingRow>
              <SettingRow icon="bell" color="#10b981" title="Notification sounds" hint="Play a tone for incoming notifications.">
                <Toggle on={settings.notificationSounds} onChange={(v) => patch({ notificationSounds: v })} label="Notification sounds" />
              </SettingRow>
              <SettingRow icon="phone" color="#eab308" title="Haptic feedback" hint="Gentle vibration on key actions (supported devices).">
                <Toggle on={settings.haptic} onChange={(v) => patch({ haptic: v })} label="Haptic feedback" />
              </SettingRow>
            </div>
          </GlassCard>

          {/* Privacy */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="lock" size={15} className="text-accent2" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">Privacy</h2>
            </div>
            <div className="border-t border-line">
              <SettingRow icon="eyeOff" color="#6366f1" title="Hide balances by default" hint="Start every session with amounts blurred.">
                <Toggle on={settings.hideBalancesByDefault} onChange={(v) => patch({ hideBalancesByDefault: v })} label="Hide balances by default" />
              </SettingRow>
              <SettingRow icon="shield" color="#10b981" title="Mask financial values" hint="Blur amounts across the app.">
                <Toggle on={settings.maskValues} onChange={(v) => patch({ maskValues: v })} label="Mask financial values" />
              </SettingRow>
            </div>
          </GlassCard>

          {/* Currency */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="globe" size={15} className="text-accent" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">Currency</h2>
            </div>
            <div className="border-t border-line">
              <SettingRow icon="bank" color="#f59e0b" title="Display currency" hint="Indian Rupee (₹) is currently supported.">
                <span className="text-sm font-bold text-snow tabular">INR ₹</span>
              </SettingRow>
            </div>
          </GlassCard>

          {/* Categories */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="tag" size={15} className="text-accent2" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">Categories</h2>
            </div>
            <div className="border-t border-line">
              <SettingRow
                icon="tag"
                color="#f59e0b"
                title="Custom categories"
                hint="Create your own categories for quicker logging."
              >
                <button
                  onClick={() => router.push("/settings/categories")}
                  className="neo h-10 w-10 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow shrink-0"
                  aria-label="Manage categories"
                >
                  <Icon name="chevronRight" size={18} />
                </button>
              </SettingRow>
            </div>
          </GlassCard>

          {/* PWA */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="download" size={15} className="text-accent" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">PWA</h2>
            </div>
            <div className="border-t border-line">
              <div className="flex items-center gap-3.5 px-5 py-4">
                <span className="h-10 w-10 rounded-xl inline-flex items-center justify-center shrink-0" style={{ background: "#10b9811a", color: "#10b981" }}>
                  <Icon name="download" size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-snow">Install FinSight</p>
                  <p className="text-[13px] text-slate mt-0.5">
                    {installed
                      ? "Installed — you're using the app."
                      : "Get a native app feel with offline support."}
                  </p>
                </div>
                <Button variant={installed ? "ghost" : "primary"} icon="download" onClick={install} disabled={installBusy}>
                  {installed ? "Installed" : "Install"}
                </Button>
              </div>
            </div>
          </GlassCard>

          {/* AI */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="sparkles" size={15} className="text-accent2" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">AI</h2>
            </div>
            <div className="border-t border-line">
              <SettingRow icon="sparkles" color="#6366f1" title="Enable AI insights" hint="Personalized observations about your money.">
                <Toggle on={settings.aiEnabled} onChange={(v) => patch({ aiEnabled: v })} label="Enable AI insights" />
              </SettingRow>
              <SettingRow icon="shield" color="#10b981" title="Insight provider" hint="On-device analysis — nothing leaves your browser.">
                <span className="text-sm font-semibold text-accent">Local</span>
              </SettingRow>
            </div>
          </GlassCard>

          {/* Security */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="shield" size={15} className="text-accent" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">Security</h2>
            </div>
            <div className="border-t border-line">
              <div className="px-5 py-4 space-y-3.5">
                {changeDone && (
                  <p className="text-sm flex items-center gap-2 text-[#10b981]">
                    <Icon name="check" size={15} /> Password changed. Other devices have been signed out.
                  </p>
                )}
                {changeError && (
                  <p className="text-sm flex items-start gap-2 text-danger">
                    <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {changeError}
                  </p>
                )}
                <label className="block">
                  <span className="block text-sm text-slate mb-1">Current password</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="field"
                    placeholder="Your current password"
                    autoComplete="current-password"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm text-slate mb-1">New password</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="field"
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <PasswordStrength password={newPassword} />
                </label>
                <label className="block">
                  <span className="block text-sm text-slate mb-1">Confirm new password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="field"
                    placeholder="Repeat your new password"
                    autoComplete="new-password"
                  />
                </label>
                <Button
                  variant="primary"
                  full
                  onClick={changePassword}
                  disabled={changeBusy || !currentPassword || !newPassword || !confirmPassword}
                  icon={changeBusy ? undefined : "lock"}
                >
                  {changeBusy ? "Updating…" : "Change password"}
                </Button>
                <p className="text-[12px] leading-relaxed text-muted">
                  Changing your password signs you out on every other device. This device
                  stays signed in.
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Account */}
          <GlassCard hover>
            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <Icon name="profile" size={15} className="text-danger" />
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">Account</h2>
            </div>
            <div className="border-t border-line">
              <SettingRow icon="profile" color="#94a3b8" title="Signed in as" hint={profile?.email}>
                <span className="text-sm font-semibold text-snow">{profile?.full_name || "FinSight user"}</span>
              </SettingRow>
            </div>
            <div className="px-5 pb-4">
              <Button variant="danger" full onClick={logout} icon="logOut">
                Log out
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </AppShell>
  );
}
