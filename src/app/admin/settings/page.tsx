"use client";

import { useEffect, useState, type ReactNode } from "react";
import AdminPage from "@/components/admin/AdminPage";
import { EmptyState, PermissionGate, SectionCard } from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch } from "@/lib/admin/client";
import { useAdminAuth } from "@/lib/admin/client";
import { hasSettingChanges } from "@/lib/admin/settingsDiff";
import { useAdminData } from "@/lib/admin/useAdminData";

type SettingsMap = Record<string, Record<string, unknown>>;

type FieldDef = {
  key: string;
  label: string;
  kind: "text" | "number" | "toggle" | "select";
  options?: string[];
};

const GROUPS: { key: string; title: string; icon: IconName; hint: string; fields: FieldDef[] }[] = [
  {
    key: "general",
    title: "General",
    icon: "settings",
    hint: "Application identity and operational state.",
    fields: [
      { key: "app_name", label: "App name", kind: "text" },
      { key: "app_description", label: "Description", kind: "text" },
      { key: "maintenance_mode", label: "Maintenance mode", kind: "toggle" },
    ],
  },
  {
    key: "finance",
    title: "Finance",
    icon: "wallet",
    hint: "Defaults used across the finance features.",
    fields: [
      { key: "default_currency", label: "Default currency", kind: "text" },
      { key: "default_categories", label: "Default categories (comma-separated)", kind: "text" },
    ],
  },
  {
    key: "notifications",
    title: "Notifications",
    icon: "bell",
    hint: "Platform-wide notification behaviour.",
    fields: [
      { key: "daily_reminder_enabled", label: "Daily reminder", kind: "toggle" },
      { key: "budget_alert_threshold", label: "Budget alert threshold (%)", kind: "number" },
      { key: "card_reminder_enabled", label: "Card reminder", kind: "toggle" },
    ],
  },
  {
    key: "ai",
    title: "AI",
    icon: "sparkles",
    hint: "AI feature flags and provider. Secrets are never stored here.",
    fields: [
      { key: "ai_enabled", label: "AI features enabled", kind: "toggle" },
      { key: "provider", label: "Provider", kind: "select", options: ["ollama", "openai", "custom"] },
    ],
  },
  {
    key: "pwa",
    title: "PWA",
    icon: "download",
    hint: "Progressive web app behaviour.",
    fields: [
      { key: "install_prompt_enabled", label: "Install prompt", kind: "toggle" },
      { key: "notification_prompt_enabled", label: "Notification prompt", kind: "toggle" },
    ],
  },
];

export default function AdminSettingsPage() {
  useEffect(() => {
    document.title = "Settings · Admin · FinSight";
  }, []);
  const toast = useToast();
  const auth = useAdminAuth();
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];
  const state = useAdminData<SettingsMap>("/settings");

  return (
    <AdminPage title="Settings" subtitle="System configuration — non-secret values only" icon="settings">
      {state.status === "error" && <EmptyState icon="alert" title="Could not load settings" hint={state.error.message} />}
      {state.status === "loading" && <div className="space-y-4"><div className="h-40 rounded-2xl glass animate-pulse" /><div className="h-40 rounded-2xl glass animate-pulse" /></div>}
      {state.status === "ready" && (
        <div className="space-y-5 animate-fade-up">
          {GROUPS.map((group) => (
            <SettingsGroup
              key={group.key}
              group={group}
              initial={state.data[group.key] ?? {}}
              onSaved={state.refresh}
              permissions={permissions}
            />
          ))}
          <p className="text-[13px] text-muted text-center">
            API keys, OTP and password material are never stored in application settings.
          </p>
        </div>
      )}
    </AdminPage>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-7 w-12 rounded-full transition-colors shrink-0"
      style={{ background: checked ? "#10b981" : "var(--tint-hi)" }}
    >
      <span
        className="absolute top-0.5 h-6 w-6 rounded-full transition-all"
        style={{ left: checked ? 22 : 2, background: checked ? "#ffffff" : "var(--text-primary)" }}
      />
    </button>
  );
}

function SettingsGroup({
  group,
  initial,
  onSaved,
  permissions,
}: {
  group: (typeof GROUPS)[number];
  initial: Record<string, unknown>;
  onSaved: () => void;
  permissions: string[];
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, unknown>>(initial);
  const [saving, setSaving] = useState(false);

  function set(key: string, value: unknown) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await adminFetch<{ value: Record<string, unknown> }>(`/settings/${group.key}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      toast.success("Settings saved.");
      setDraft(res.value ?? draft);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // F-13: compare declared fields only, with per-kind normalization, so
  // reverting an edit clears the dirty state and server-side extras
  // (e.g. last_health_check) never produce phantom changes.
  const changed = hasSettingChanges(group.fields, initial, draft);

  return (
    <SectionCard title={group.title} icon={group.icon}>
      <div className="p-5 pt-3">
        <p className="text-[13px] text-slate mb-4">{group.hint}</p>
        <div className="space-y-4">
          {group.fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={draft[field.key]}
              onChange={(v) => set(field.key, v)}
            />
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <PermissionGate permission="SYSTEM_SETTINGS" permissions={permissions}>
            <Button variant="primary" icon="check" disabled={!changed || saving} onClick={save}>
              {saving ? "Saving…" : "Save group"}
            </Button>
          </PermissionGate>
        </div>
      </div>
    </SectionCard>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-snow">{field.label}</span>
      {field.kind === "toggle" ? (
        <Toggle checked={Boolean(value)} onChange={onChange} />
      ) : field.kind === "select" ? (
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="field !py-2 text-sm w-44"
          aria-label={field.label}
        >
          {field.options!.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : field.kind === "number" ? (
        <input
          type="number"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="field !py-2 text-sm w-44 text-right"
          aria-label={field.label}
        />
      ) : (
        <input
          type="text"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="field !py-2 text-sm w-56"
          aria-label={field.label}
        />
      )}
    </label>
  );
}
