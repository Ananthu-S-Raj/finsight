"use client";

import { memo, useState } from "react";
import type { Transaction } from "@/lib/finance";
import Icon, { type IconName } from "./ui/Icons";
import { dayLabel, inr } from "@/lib/format";

export const TXN_LABEL: Record<Transaction["type"], string> = {
  salary_add: "Salary added",
  savings_add: "Savings added",
  savings_move: "Moved to savings",
  expense: "Expense",
  credit_card: "Card charge",
  loan_add: "Loan received",
  credit_card_payment: "Card payment",
};

export const TXN_SIGN: Record<Transaction["type"], "+" | "-"> = {
  salary_add: "+",
  savings_add: "+",
  savings_move: "-",
  expense: "-",
  credit_card: "-",
  loan_add: "+",
  credit_card_payment: "-",
};

export function txIcon(tx: Transaction): IconName {
  switch (tx.type) {
    case "salary_add":
      return "income";
    case "savings_add":
      return "piggy";
    case "savings_move":
      return "transfer";
    case "expense":
      return "expense";
    case "credit_card":
      return "creditCard";
    case "credit_card_payment":
      return "creditCard";
    case "loan_add":
      return "coins";
  }
}

export function txColor(tx: Transaction): string {
  if (tx.type === "credit_card") return "#f59e0b";
  if (tx.type === "credit_card_payment") return "#6366f1";
  if (TXN_SIGN[tx.type] === "+") return "#10b981";
  return "#ef4444";
}

export function txTitle(tx: Transaction): string {
  if (tx.type === "expense" || tx.type === "credit_card") {
    return tx.subcategory || tx.category || "Expense";
  }
  if (tx.type === "loan_add") return "Loan received";
  if (tx.type === "credit_card_payment") return "Card payment";
  if (tx.note) return `${TXN_LABEL[tx.type]} · ${tx.note}`;
  return TXN_LABEL[tx.type];
}

export function txSubtitle(tx: Transaction): string {
  const parts: string[] = [];
  if (tx.type === "expense" || tx.type === "credit_card") {
    if (tx.category) parts.push(tx.category);
    if (tx.note) parts.push(tx.note);
    if (parts.length === 0) parts.push("Expense");
  }
  if (tx.type === "salary_add" && tx.note) parts.push(tx.note);
  if (tx.type === "savings_add" && tx.note) parts.push(tx.note);
  if (tx.type === "loan_add" && tx.note) parts.push(`from ${tx.note}`);
  if (tx.type === "savings_move") parts.push("salary → savings");
  if (tx.type === "credit_card_payment" && tx.note)
    parts.push(tx.note === "savings" ? "savings" : "account balance");
  if (parts.length === 0) parts.push(TXN_LABEL[tx.type]);
  return parts.join(" · ");
}

export default memo(function TransactionRow({
  tx,
  onOpen,
  compact = false,
}: {
  tx: Transaction;
  onOpen?: (tx: Transaction) => void;
  compact?: boolean;
}) {
  const color = txColor(tx);
  const title = txTitle(tx);

  return (
    <button
      onClick={() => onOpen?.(tx)}
      className={`w-full flex items-center gap-3.5 rounded-2xl glass-soft p-3.5 row-press text-left ${
        onOpen ? "glass-hover cursor-pointer" : "cursor-default"
      }`}
    >
      <span
        className="h-11 w-11 rounded-xl inline-flex items-center justify-center shrink-0"
        style={{ background: `${color}1a`, color }}
      >
        <Icon name={txIcon(tx)} size={19} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-snow truncate">{title}</span>
        <span className="block text-[13px] text-slate mt-0.5 truncate">
          {txSubtitle(tx)} · {dayLabel(tx.created_at)}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5 shrink-0">
        <span
          className={`font-semibold tabular ${compact ? "text-sm" : "text-base"}`}
          style={{ color }}
        >
          {TXN_SIGN[tx.type]}
          {inr(tx.amount)}
        </span>
        {Number(tx.overspend_amount) > 0 && (
          <span className="text-[13px] font-semibold uppercase tracking-wide text-warn">
            overspent
          </span>
        )}
      </span>
      {onOpen && (
        <Icon name="chevronRight" size={16} className="text-slate shrink-0" />
      )}
    </button>
  );
});
