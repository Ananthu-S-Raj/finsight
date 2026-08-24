"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useReducedMotion } from "@/lib/hooks";
import { haptic } from "@/lib/haptics";
import Icon from "./Icons";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Max height as a fraction of the viewport (mobile). */
  maxHeight?: string;
  className?: string;
}

export default function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxHeight = "min(88dvh, 760px)",
  className = "",
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [vvHeight, setVvHeight] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const startY = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pushedRef = useRef(false);

  // Mount / unmount with a transition.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), reduced ? 0 : 300);
    return () => window.clearTimeout(t);
  }, [open, reduced]);

  // Escape closes; lock background overscroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overscrollBehavior = "none";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overscrollBehavior = "";
    };
  }, [open, onClose]);

  // Keep the sheet within the visual viewport so focused inputs stay above the
  // mobile keyboard.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => setVvHeight(vv.height);
    measure();
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
      setVvHeight(null);
    };
  }, [open]);

  // Android back-button support: push a history entry while open and close on
  // popstate. The entry is removed when the sheet closes programmatically.
  useEffect(() => {
    if (!open) {
      if (pushedRef.current && window.history.state?.finsightSheet) {
        pushedRef.current = false;
        window.history.back();
      }
      return;
    }
    pushedRef.current = true;
    window.history.pushState({ finsightSheet: true }, "");
    const onPop = () => {
      pushedRef.current = false;
      onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || reduced) return;
    const focusable = sheetRef.current?.querySelector<HTMLElement>("[autofocus], input, button, select, textarea");
    focusable?.focus();
  }, [open, reduced]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = contentRef.current;
      if (!el) return;
      const atTop = el.scrollTop <= 0;
      const inHandleZone = e.clientY - el.getBoundingClientRect().top < 64;
      if (!atTop && !inHandleZone) return;
      startY.current = e.clientY;
      setDragging(true);
    },
    []
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dy = e.clientY - startY.current;
    setDragY(Math.max(0, dy));
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (dragY > 110) {
      haptic("light");
      onClose();
    } else {
      setDragY(0);
    }
  }, [dragging, dragY, onClose]);

  if (!mounted) return null;

  const translate = dragY || (shown ? 0 : "105%");

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={title ?? "Sheet"}>
      <div
        className={`absolute inset-0 bg-scrim ${shown ? "opacity-100" : "opacity-0"} transition-opacity duration-300`}
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={`absolute inset-x-0 bottom-0 mx-auto w-full flex flex-col rounded-t-3xl border border-b-0 border-line bg-surface ${className}`}
        style={{
          maxWidth: 640,
          maxHeight: vvHeight ? Math.min(vvHeight, 760) + "px" : maxHeight,
          height: vvHeight ? Math.min(vvHeight, 760) + "px" : undefined,
          transform: `translateY(${typeof translate === "string" ? translate : translate + "px"})`,
          transition: dragging
            ? "none"
            : `transform ${reduced ? 0 : 300}ms cubic-bezier(0.16,1,0.3,1)`,
          boxShadow: "var(--shadow-glass-lg)",
        }}
      >
        <div
          className="pt-2.5 pb-1 px-6 shrink-0 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ cursor: dragging ? "grabbing" : "grab" }}
          role="presentation"
        >
          <div className="mx-auto h-1.5 w-14 rounded-full bg-tint-hi" aria-hidden="true" />
        </div>

        {(title || subtitle) && (
          <div className="flex items-center justify-between px-6 pb-3 shrink-0">
            <div>
              {title && <h2 className="text-lg font-semibold text-snow">{title}</h2>}
              {subtitle && <p className="text-sm text-slate mt-0.5">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="neo h-11 w-11 rounded-xl inline-flex items-center justify-center text-slate hover:text-snow shrink-0"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
        )}

        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto scroll-slim px-6 pb-8"
          style={{ paddingBottom: "calc(var(--safe-bottom) + 2rem)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
