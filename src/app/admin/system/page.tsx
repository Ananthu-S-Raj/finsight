"use client";

import { useEffect, useState } from "react";
import AdminPage from "@/components/admin/AdminPage";
import { EmptyState, SectionCard, StatusBadge } from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch, useAdminAuth } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";

type SystemStatus = {
  app: { name: string; maintenance: boolean; version: string; runtime: string; node_env: string; build_time: string | null };
  services: { database: boolean; settings: boolean };
  maintenance_mode: boolean;
  generated_at: string;
};

export default function AdminSystemPage() {
  useEffect(() => {
    document.title = "System · Admin · FinSight";
  }, []);
  const toast = useToast();
  const auth = useAdminAuth();
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];
  const canMaintain = permissions.includes("SYSTEM_SETTINGS");
  const state = useAdminData<SystemStatus>("/system");

  async function toggleMaintenance(current: boolean) {
    try {
      await adminFetch("/system/maintenance", { method: "POST", body: JSON.stringify({ enabled: !current }) });
      toast.success(current ? "Maintenance mode disabled." : "Maintenance mode enabled. Users are locked out; admins retain access.");
      state.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update maintenance mode.");
    }
  }

  return (
    <AdminPage title="System" subtitle="Runtime status and operational controls" icon="globe">
      {state.status === "error" && <EmptyState icon="alert" title="Could not load system status" hint={state.error.message} />}
      {state.status === "loading" && <div className="h-48 rounded-2xl glass animate-pulse" />}
      {state.status === "ready" && (
        <div className="space-y-5 animate-fade-up">
          <SectionCard title="Application" icon="globe">
            <div className="divide-y divide-line border-t border-line">
              <SysRow label="Application" value={state.data.app.name} />
              <SysRow label="Version" value={state.data.app.version} />
              <SysRow label="Environment" value={state.data.app.node_env} />
              <SysRow label="Runtime" value={state.data.app.runtime} />
              <SysRow label="Generated" value={new Date(state.data.generated_at).toLocaleString("en-IN")} />
              <SysRow
                label="Status"
                value={<StatusBadge value={state.data.maintenance_mode ? "disabled" : "active"} />}
              />
            </div>
          </SectionCard>

          <SectionCard title="Services" icon="shield">
            <div className="divide-y divide-line border-t border-line">
              <ServiceRow label="Database" ok={state.data.services.database} />
              <ServiceRow label="Settings store" ok={state.data.services.settings} />
            </div>
          </SectionCard>

          <SectionCard title="Operational controls" icon="settings">
            <div className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-snow">
                  {state.data.maintenance_mode ? "Maintenance mode is ON" : "Maintenance mode is OFF"}
                </p>
                <p className="text-[13px] text-slate mt-0.5">
                  {state.data.maintenance_mode
                    ? "Regular users are locked out of the app. Administrators always retain access."
                    : "All users can access FinSight normally."}
                </p>
              </div>
              {canMaintain && (
                <MaintenanceButton
                  mode={state.data.maintenance_mode}
                  onConfirm={() => toggleMaintenance(state.data.maintenance_mode)}
                />
              )}
            </div>
          </SectionCard>
        </div>
      )}
    </AdminPage>
  );
}

function SysRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <p className="text-sm text-slate">{label}</p>
      <p className="text-sm font-semibold text-snow">{value}</p>
    </div>
  );
}

function ServiceRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-3">
      <span className="h-3 w-3 rounded-full shrink-0" style={{ background: ok ? "#10b981" : "#ef4444", boxShadow: ok ? "0 0 8px #10b981" : "0 0 8px #ef4444" }} />
      <p className="flex-1 text-sm font-semibold text-snow">{label}</p>
      <p className="text-[13px] font-semibold" style={{ color: ok ? "#10b981" : "#ef4444" }}>{ok ? "Healthy" : "Down"}</p>
    </div>
  );
}

function MaintenanceButton({ mode, onConfirm }: { mode: boolean; onConfirm: () => void }) {
  const toast = useToast();
  const [armed, setArmed] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {armed && (
        <Button
          variant={mode ? "primary" : "danger"}
          onClick={() => {
            onConfirm();
            setArmed(false);
          }}
        >
          Yes, {mode ? "disable" : "enable"} maintenance
        </Button>
      )}
      <Button
        variant={mode ? "danger" : "neo"}
        icon="alert"
        disabled={armed}
        onClick={() => {
          toast.warning("Tap again to confirm this is not a drill.");
          setArmed(true);
        }}
      >
        {armed ? "Armed — confirm" : mode ? "Disable maintenance" : "Enable maintenance"}
      </Button>
    </div>
  );
}
