"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/hooks";
import { inr } from "@/lib/format";
import Icon from "./ui/Icons";

export interface ChartDatum {
  label: string;
  value: number;
  secondary?: number;
}

interface TrendChartProps {
  data: ChartDatum[];
  color?: string;
  secondaryColor?: string;
  height?: number;
  label?: string;
  formatValue?: (n: number) => string;
  emptyLabel?: string;
}

function buildPath(points: { x: number; y: number }[], smooth = true) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (!smooth) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const mx = (prev.x + cur.x) / 2;
    d += ` C ${mx} ${prev.y}, ${mx} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  return d;
}

export default function TrendChart({
  data,
  color = "#10b981",
  secondaryColor = "#6366f1",
  height = 200,
  label,
  formatValue = (n) => inr(n),
  emptyLabel = "No data yet",
}: TrendChartProps) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const [draw, setDraw] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (reduced) {
      setDraw(true);
      return;
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setDraw(true)));
    return () => cancelAnimationFrame(raf);
  }, [data, reduced]);

  const { linePath, areaPath, points } = useMemo(() => {
    const padX = 14;
    const padTop = 18;
    const padBottom = 8;
    const innerH = height - padTop - padBottom;

    const values = data.map((d) => d.value);
    const max = Math.max(1, ...values);
    const min = Math.min(...values, 0);
    const range = Math.max(max - min, 1);
    const n = data.length;

    const pts = data.map((d, i) => {
      const x = n === 1 ? width / 2 : padX + (i * (width - padX * 2)) / (n - 1);
      const y = padTop + innerH * (1 - (d.value - min) / range);
      return { x, y, raw: d };
    });

    const line = buildPath(pts);
    const area = pts.length
      ? `${line} L ${pts[pts.length - 1].x} ${height - padBottom} L ${pts[0].x} ${height - padBottom} Z`
      : "";
    return { linePath: line, areaPath: area, points: pts };
  }, [data, width, height]);

  const activePoint = active !== null ? points[active] : null;

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!points.length || width === 0) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setActive(best);
  }

  if (data.length === 0 || width < 50) {
    return (
      <div ref={containerRef} style={{ height }} className="flex items-center justify-center">
        <span className="text-sm text-slate flex items-center gap-2">
          <Icon name="chart" size={16} /> {emptyLabel}
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full select-none" style={{ height }}>
      {label && <p className="text-[13px] text-slate absolute top-0 left-0">{label}</p>}
      <svg
        width={width}
        height={height}
        onPointerMove={handleMove}
        onPointerLeave={() => setActive(null)}
        className="touch-none"
        role="img"
        aria-label={label ?? "Trend chart"}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lineFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={secondaryColor} />
          </linearGradient>
        </defs>

        {/* grid lines */}
        {[0.25, 0.5, 0.75].map((f) => {
          const y = 18 + (height - 26) * (1 - f);
          return (
            <line
              key={f}
              x1={14}
              x2={width - 14}
              y1={y}
              y2={y}
              stroke="var(--line)"
              strokeDasharray="2 5"
            />
          );
        })}

        <path d={areaPath} fill="url(#areaFill)" style={{ opacity: draw ? 1 : 0, transition: "opacity 700ms ease" }} />

        <path
          d={linePath}
          fill="none"
          stroke="url(#lineFill)"
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{
            strokeDasharray: draw ? "none" : "0 1",
            strokeDashoffset: 0,
            filter: `drop-shadow(0 0 6px ${color}55)`,
          }}
        />

        {/* hit targets + dots */}
        {points.map((p, i) => (
          <g key={i} className="cursor-pointer">
            <rect
              x={p.x - 24}
              y={0}
              width={48}
              height={height}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={active === i ? 5.5 : 3.5}
              fill={active === i ? "var(--surface)" : color}
              stroke={active === i ? color : "none"}
              strokeWidth={2}
              style={{ transition: "r 150ms ease, fill 150ms ease" }}
            />
          </g>
        ))}
      </svg>

      {/* floating tooltip */}
      {activePoint && (
        <div
          className="glass-elevated rounded-xl px-3 py-2 pointer-events-none absolute -translate-x-1/2 animate-scale-in"
          style={{
            left: Math.max(60, Math.min(width - 60, activePoint.x)),
            top: Math.max(4, activePoint.y - 54),
            zIndex: 10,
            minWidth: 120,
          }}
        >
          <p className="text-[13px] text-slate mb-0.5">{activePoint.raw.label}</p>
          <p className="text-sm font-bold text-snow tabular" style={{ color }}>
            {formatValue(activePoint.raw.value)}
          </p>
          {typeof activePoint.raw.secondary === "number" && (
            <p className="text-[13px] text-slate tabular mt-0.5">
              {formatValue(activePoint.raw.secondary)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
