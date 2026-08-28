"use client";

import { useEffect, useMemo, useState } from "react";
import type { Transaction } from "@/lib/finance";
import BottomSheet from "./ui/BottomSheet";
import Button from "./ui/Button";
import Icon from "./ui/Icons";
import { useToast } from "./ui/ToastProvider";
import { txIcon, txTitle, TXN_LABEL, TXN_SIGN } from "./TransactionRow";
import { inr, timeAgo } from "@/lib/format";
import { CATEGORY_PRESETS } from "@/lib/finance";
import { toCategoryOptions } from "@/lib/categories";
import { useCategories } from "@/lib/useCategories";
import { deleteTransaction, duplicateTransaction, updateTransaction } from "@/lib/analytics";
import { emitRefresh } from "@/lib/events";
import { haptic } from "@/lib/haptics";

interface Props {
  tx: Transaction | null;
  onClose: () => void;
  userId: string;
}

export default function TransactionDetailSheet({ tx, onClose, userId }: Props) {
  const toast = useToast();
  const { categories } = useCategories(userId);
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tx) {
      setCategory(tx.category ?? "");
      setSubcategory(tx.subcategory ?? "");
      setNote(tx.note ?? "");
      setEditing(false);
    }
  }, [tx]);

  const isSpend = tx?.type === "expense" || tx?.type === "credit_card";

  const canonicalOptions = toCategoryOptions(categories ?? []);
  const categoryOptions =
    canonicalOptions.length > 0
      ? canonicalOptions
      : Object.keys(CATEGORY_PRESETS).map((name) => ({
          id: null as string | null,
          name,
          children: CATEGORY_PRESETS[name],
        }));
  const subcategories =
    categoryOptions.find((o) => o.name === category)?.children ?? [];

  const quickActions = useMemo(() => {
    if (!tx) return [];
    return [
      { id: "duplicate", label: "Duplicate", icon: "copy" as const },
      { id: "edit", label: "Edit", icon: "edit" as const },
      ...(isSpend ? [{ id: "categorize", label: "Categorize", icon: "tag" as const }] : []),
      { id: "delete", label: "Delete", icon: "trash" as const, danger: true },
    ];
  }, [tx, isSpend]);

  if (!tx) return null;

  const color = isSpend ? "#ef4444" : "#10b981";

  async function runAction(id: string) {
    if (!tx || busy) return;
    if (id === "duplicate") {
      setBusy(true);
      try {
        await duplicateTransaction(userId, tx);
        haptic("success");
        toast.success("Transaction duplicated.");
        emitRefresh();
        onClose();
      } catch {
        toast.error("Couldn't duplicate that entry.");
      } finally {
        setBusy(false);
      }
    } else if (id === "delete") {
      setBusy(true);
      try {
        await deleteTransaction(userId, tx.id);
        haptic("success");
        toast.success("Transaction deleted.");
        emitRefresh();
        onClose();
      } catch {
        toast.error("Couldn't delete that entry.");
      } finally {
        setBusy(false);
      }
    } else if (id === "edit" || id === "categorize") {
      setEditing(true);
    }
  }

  async function saveEdit() {
    if (!tx) return;
    setBusy(true);
    try {
      await updateTransaction(userId, tx.id, {
        category: isSpend ? category || null : tx.category,
        subcategory: isSpend ? subcategory || null : tx.subcategory,
        note: note || null,
      });
      haptic("success");
      toast.success(isSpend ? "Expense updated." : "Note updated.");
      emitRefresh();
      setEditing(false);
    } catch {
      toast.error("Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={Boolean(tx)}
      onClose={onClose}
      title={editing ? "Edit transaction" : undefined}
    >
      {editing ? (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="h-12 w-12 rounded-2xl inline-flex items-center justify-center" style={{ background: `${color}1a`, color }}>
              <Icon name={txIcon(tx)} size={22} />
            </span>
            <div>
              <p className="text-sm text-slate">Original amount</p>
              <p className="text-xl font-bold text-snow tabular">
                {TXN_SIGN[tx.type]}
                {inr(tx.amount)}
              </p>
            </div>
          </div>

          {isSpend && (
            <>
              <div>
                <p className="text-[13px] uppercase tracking-widest text-slate mb-2 font-medium">Category</p>
                <div className="flex flex-wrap gap-2">
                  {categoryOptions.map((c) => (
                    <button
                      key={c.id ?? c.name}
                      onClick={() => {
                        setCategory(c.name);
                        setSubcategory(c.children[0] ?? "Other");
                      }}
                      className={`neo-chip ${category === c.name ? "!text-snow !border-accent/50" : ""}`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              {subcategories.length > 0 && (
                <div>
                  <p className="text-[13px] uppercase tracking-widest text-slate mb-2 font-medium">Merchant</p>
                  <div className="flex flex-wrap gap-2">
                    {subcategories.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSubcategory(s)}
                        className={`neo-chip ${subcategory === s ? "!text-snow !border-accent2/50" : ""}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <label className="block">
            <p className="text-[13px] uppercase tracking-widest text-slate mb-2 font-medium">Note</p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="field"
              placeholder="Add a note"
            />
          </label>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setEditing(false)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={saveEdit} disabled={busy} className="flex-1">
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-soft rounded-2xl p-5 flex items-center gap-4">
            <span className="h-14 w-14 rounded-2xl inline-flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}>
              <Icon name={txIcon(tx)} size={26} />
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-snow truncate">{txTitle(tx)}</h3>
              <p className="text-sm text-slate">{TXN_LABEL[tx.type]}</p>
            </div>
            <p className="text-2xl font-bold tabular" style={{ color }}>
              {TXN_SIGN[tx.type]}
              {inr(tx.amount)}
            </p>
          </div>

          <div className="space-y-2.5">
            {[
              ["When", new Date(tx.created_at).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })],
              ["Logged", timeAgo(tx.created_at)],
              ...(tx.category ? [["Category", tx.category] as const] : []),
              ...(tx.subcategory ? [["Merchant", tx.subcategory] as const] : []),
              ...(tx.note ? [["Note", tx.note] as const] : []),
              ...(Number(tx.overspend_amount) > 0
                ? [[`Overspent (deducted from salary)`, inr(Number(tx.overspend_amount))] as const]
                : []),
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 rounded-xl neo-inset px-4 py-3">
                <span className="text-sm text-slate">{k}</span>
                <span className="text-sm font-semibold text-snow text-right">{v}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {quickActions.map((a) => (
              <Button
                key={a.id}
                variant={a.danger ? "danger" : "default"}
                icon={a.icon}
                onClick={() => runAction(a.id)}
                disabled={busy}
                className={a.danger ? "!col-span-2" : ""}
              >
                {busy && a.id === "delete" ? "Deleting…" : a.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
