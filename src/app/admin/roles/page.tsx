"use client";

import { useEffect, useState } from "react";
import AdminPage from "@/components/admin/AdminPage";
import { EmptyState, SectionCard } from "@/components/admin/ui";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { ALL_PERMISSIONS, PERMISSION_LABELS } from "@/lib/admin/permissions";
import { adminFetch, useAdminAuth, type RoleWithPermissions } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";

export default function AdminRolesPage() {
  useEffect(() => {
    document.title = "Roles · Admin · FinSight";
  }, []);
  const toast = useToast();
  const auth = useAdminAuth();
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];
  const canManage = permissions.includes("ROLE_MANAGE");
  const state = useAdminData<RoleWithPermissions[]>("/roles");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function toggle(role: RoleWithPermissions, code: string) {
    if (!canManage || role.is_system || busyKey) return;
    const key = `${role.id}:${code}`;
    setBusyKey(key);
    try {
      if (role.permissions.includes(code)) {
        await adminFetch(`/roles/${role.id}/permissions/${code}`, { method: "DELETE" });
        toast.success(`Revoked ${code} from "${role.name}".`);
      } else {
        await adminFetch(`/roles/${role.id}/permissions`, {
          method: "POST",
          body: JSON.stringify({ permission_id: code }),
        });
        toast.success(`Granted ${code} to "${role.name}".`);
      }
      state.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the permission.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <AdminPage
      title="Roles & Permissions"
      subtitle={canManage ? "Role matrix — click a cell on a custom role to grant or revoke" : "Read-only role matrix"}
      icon="shield"
    >
      {state.status === "error" && (
        <SectionCard>
          <EmptyState icon="alert" title="Could not load roles" hint={state.error.message} />
        </SectionCard>
      )}
      {state.status === "loading" && <div className="h-40 rounded-2xl glass animate-pulse" />}
      {state.status === "ready" && (
        <div className="overflow-x-auto scroll-slim animate-fade-up">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-[13px] uppercase tracking-widest text-slate border-b border-line">
                <th className="px-5 py-3 font-semibold">Permission</th>
                {state.data.map((role) => (
                  <th key={role.id} className="px-4 py-3 font-semibold text-center">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[13px] inline-flex items-center gap-1 ${role.is_system ? "text-accent" : "text-snow"}`}
                      style={{ background: "var(--tint)" }}
                    >
                      {role.name}
                      {role.is_system && <Icon name="lock" size={11} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ALL_PERMISSIONS.map((code) => (
                <tr key={code} className="hover:bg-tint transition-colors">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-snow">{PERMISSION_LABELS[code]}</p>
                    <p className="text-[13px] text-slate font-mono">{code}</p>
                  </td>
                  {state.data.map((role) => {
                    const granted = role.permissions.includes(code);
                    const editable = canManage && !role.is_system;
                    const busy = busyKey === `${role.id}:${code}`;
                    const cell = (
                      <span
                        className={`inline-flex h-6 w-6 rounded-lg items-center justify-center transition-opacity ${busy ? "opacity-40" : ""} ${
                          granted
                            ? "text-[#04140d]"
                            : "text-muted"
                        }`}
                        style={{
                          background: granted
                            ? "linear-gradient(135deg,#10b981,#34d399)"
                            : "var(--tint)",
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3">
                          {granted ? <path d="M4 12l5 5L20 6" /> : <path d="M6 6l12 12M18 6L6 18" />}
                        </svg>
                      </span>
                    );
                    return (
                      <td key={role.id} className="px-4 py-3 text-center">
                        {editable ? (
                          <button
                            type="button"
                            disabled={Boolean(busyKey)}
                            onClick={() => void toggle(role, code)}
                            aria-label={`${granted ? "Revoke" : "Grant"} ${code} ${granted ? "from" : "to"} ${role.name}`}
                            className="inline-flex hover:scale-110 active:scale-95 transition-transform"
                          >
                            {cell}
                          </button>
                        ) : (
                          cell
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <p className="text-[13px] text-slate mt-4 text-center flex items-center justify-center gap-1.5 flex-wrap">
          <Icon name="lock" size={13} /> System roles are protected and cannot be modified.
          Changes take effect on each administrator&apos;s next console request and are audited.
        </p>
      )}
      {!canManage && (
        <p className="text-[13px] text-muted mt-4 text-center">
          Roles and grants are enforced server-side and validated against the database on every request.
        </p>
      )}
    </AdminPage>
  );
}
