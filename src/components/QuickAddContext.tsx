"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { AddMode } from "./QuickAddSheet";

const QuickAddOpenContext = createContext<(mode: AddMode) => void>(() => {});
const QuickAddStateContext = createContext<{ mode: AddMode | null; close: () => void }>({
  mode: null,
  close: () => {},
});

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AddMode | null>(null);
  const close = useCallback(() => setMode(null), []);
  return (
    <QuickAddStateContext.Provider value={{ mode, close }}>
      <QuickAddOpenContext.Provider value={setMode}>{children}</QuickAddOpenContext.Provider>
    </QuickAddStateContext.Provider>
  );
}

export function useQuickAdd() {
  return useContext(QuickAddOpenContext);
}

export function useQuickAddState() {
  return useContext(QuickAddStateContext);
}
