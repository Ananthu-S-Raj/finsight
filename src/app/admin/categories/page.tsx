"use client";

import { useEffect, useState } from "react";
import AdminPage from "@/components/admin/AdminPage";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { EmptyState, SectionCard } from "@/components/admin/ui";
import Button from "@/components/ui/Button";
import GlassCard from "@/components/ui/GlassCard";
import Icon from "@/components/ui/Icons";
import { useToast } from "@/components/ui/ToastProvider";
import { adminFetch, useAdminAuth, type CategoryNode } from "@/lib/admin/client";
import { useAdminData } from "@/lib/admin/useAdminData";

type FormMode =
  | { kind: "create-root" }
  | { kind: "create-child"; parent: CategoryNode }
  | { kind: "rename"; category: CategoryNode }
  | null;

export default function AdminCategoriesPage() {
  useEffect(() => {
    document.title = "Categories · Admin · FinSight";
  }, []);
  const toast = useToast();
  const auth = useAdminAuth();
  const permissions = auth.status === "ready" ? auth.whoami.permissions : [];
  const canManage = permissions.includes("CATEGORY_MANAGE");
  const state = useAdminData<{ items: CategoryNode[] }>("/categories");
  const [form, setForm] = useState<FormMode>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CategoryNode | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitForm() {
    if (!form) return;
    setBusy(true);
    try {
      if (form.kind === "rename") {
        await adminFetch(`/categories/${form.category.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
        toast.success("Category renamed.");
      } else if (form.kind === "create-child") {
        await adminFetch("/categories", { method: "POST", body: JSON.stringify({ name, parent_id: form.parent.id }) });
        toast.success("Subcategory added.");
      } else {
        await adminFetch("/categories", { method: "POST", body: JSON.stringify({ name }) });
        toast.success("Category created.");
      }
      state.refresh();
      setForm(null);
      setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled(node: CategoryNode) {
    setBusy(true);
    try {
      await adminFetch(`/categories/${node.id}`, { method: "PATCH", body: JSON.stringify({ is_disabled: !node.is_disabled }) });
      toast.success(node.is_disabled ? "Category re-enabled." : "Category disabled.");
      state.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCategory() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const res = await adminFetch<{ id: string; deleted?: boolean; disabled?: boolean }>(`/categories/${pendingDelete.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      toast.success(res.deleted ? "Category deleted." : "Category is in use and was disabled instead.");
      state.refresh();
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      title="Categories"
      subtitle="The canonical category list used across FinSight"
      icon="tag"
      actions={
        canManage && (
          <Button variant="primary" icon="plus" onClick={() => { setName(""); setForm({ kind: "create-root" }); }}>
            New category
          </Button>
        )
      }
    >
      <SectionCard title="Category tree" className="mt-1">
        {state.status === "error" && <EmptyState icon="alert" title="Could not load categories" hint={state.error.message} />}
        {state.status === "loading" && <div className="h-40 rounded-2xl glass animate-pulse" />}
        {state.status === "ready" && (
          <div className="divide-y divide-line border-t border-line">
            {state.data.items.length === 0 && <EmptyState icon="tag" title="No categories yet" />}
            {state.data.items.map((node) => (
              <CategoryNodeRow
                key={node.id}
                node={node}
                depth={0}
                busy={busy}
                canManage={canManage}
                onAddChild={(parent) => { setName(""); setForm({ kind: "create-child", parent }); }}
                onRename={(category) => { setName(category.name); setForm({ kind: "rename", category }); }}
                onToggle={toggleDisabled}
                onDelete={(category) => setPendingDelete(category)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {form && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-scrim backdrop-blur-sm" onClick={() => setForm(null)} aria-hidden="true" />
          <GlassCard className="relative w-full max-w-md p-6 animate-fade-up">
            <h3 className="text-base font-bold text-snow">
              {form.kind === "rename" ? "Rename category" : form.kind === "create-child" ? `Add subcategory under ${form.parent.name}` : "New category"}
            </h3>
            <label className="text-[13px] uppercase tracking-wider text-slate font-medium block mb-1.5 mt-5">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="e.g. Travel, Food, Salary…" maxLength={60} autoFocus />
            <div className="mt-6 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
              <Button variant="primary" disabled={!name.trim() || busy} onClick={submitForm}>
                {form.kind === "rename" ? "Save" : "Create"}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete category"
        message={
          <>
            Delete <strong className="text-snow">{pendingDelete?.name}</strong>? If any transactions still reference it, it will be disabled instead so history stays intact.
          </>
        }
        confirmText="DELETE"
        onConfirm={deleteCategory}
        onClose={() => setPendingDelete(null)}
      />
    </AdminPage>
  );
}

function CategoryNodeRow({
  node,
  depth,
  busy,
  canManage,
  onAddChild,
  onRename,
  onToggle,
  onDelete,
}: {
  node: CategoryNode;
  depth: number;
  busy: boolean;
  canManage: boolean;
  onAddChild: (parent: CategoryNode) => void;
  onRename: (category: CategoryNode) => void;
  onToggle: (category: CategoryNode) => void;
  onDelete: (category: CategoryNode) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3 px-5 py-3" style={{ paddingLeft: 20 + depth * 28 }}>
        <span className="h-8 w-8 rounded-xl inline-flex items-center justify-center shrink-0 text-accent" style={{ background: "var(--tint)" }}>
          <Icon name="tag" size={15} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-snow truncate">
            {node.name}
            {node.is_default && <span className="ml-2 text-[13px] text-slate">default</span>}
            {node.is_disabled && <span className="ml-2 text-[13px] text-warn">disabled</span>}
          </p>
          <p className="text-[13px] text-slate">{node.children.length} subcategories</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" disabled={busy} onClick={() => onAddChild(node)} title="Add subcategory">
              <Icon name="plus" size={14} />
            </Button>
            <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" disabled={busy} onClick={() => onRename(node)} title="Rename">
              <Icon name="edit" size={14} />
            </Button>
            <Button variant="neo" className="btn-sm !px-2.5 !py-1.5 text-[13px]" disabled={busy} onClick={() => onToggle(node)} title={node.is_disabled ? "Re-enable" : "Disable"}>
              <Icon name={node.is_disabled ? "eye" : "eyeOff"} size={14} />
            </Button>
            <Button variant="danger" className="btn-sm !px-2.5 !py-1.5 text-[13px]" disabled={busy} onClick={() => onDelete(node)} title="Delete">
              <Icon name="trash" size={14} />
            </Button>
          </div>
        )}
      </div>
      {node.children.map((child) => (
        <CategoryNodeRow key={child.id} node={child} depth={depth + 1} busy={busy} canManage={canManage} onAddChild={onAddChild} onRename={onRename} onToggle={onToggle} onDelete={onDelete} />
      ))}
    </>
  );
}
