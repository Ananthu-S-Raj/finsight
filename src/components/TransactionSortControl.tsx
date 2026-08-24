"use client";

import { haptic } from "@/lib/haptics";

interface Props {
  order: "date" | "amount";
  direction: "asc" | "desc";
  onChange: (order: "date" | "amount", direction: "asc" | "desc") => void;
}

const OPTIONS: { id: string; order: "date" | "amount"; direction: "asc" | "desc"; label: string }[] = [
  { id: "newest", order: "date", direction: "desc", label: "Newest" },
  { id: "oldest", order: "date", direction: "asc", label: "Oldest" },
  { id: "amt-desc", order: "amount", direction: "desc", label: "Amount ↓" },
  { id: "amt-asc", order: "amount", direction: "asc", label: "Amount ↑" },
];

export default function TransactionSortControl({ order, direction, onChange }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar" role="radiogroup" aria-label="Sort transactions">
      {OPTIONS.map((o) => {
        const active = order === o.order && direction === o.direction;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={active}
            type="button"
            onClick={() => {
              if (!active) {
                haptic("light");
                onChange(o.order, o.direction);
              }
            }}
            className={`neo-chip whitespace-nowrap ${active ? "!text-snow !border-accent2/50 shadow-glow-indigo" : ""}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
