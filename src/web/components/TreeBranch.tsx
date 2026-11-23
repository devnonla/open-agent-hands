import { Children, type ReactNode } from "react";
import { cn } from "src/common/lib/cn";

interface TreeBranchProps {
  children: ReactNode;
  lineX?: number;
  elbowY?: number;
  indent?: number;
  radius?: number;
  reach?: number;
  className?: string;
}

function Connector({ last, lineX, elbowY, indent, radius, reach }: { last: boolean; lineX: number; elbowY: number; indent: number; radius: number; reach: number }) {
  const r = Math.min(radius, elbowY, indent - lineX - 4);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 text-foreground opacity-30" style={{ width: indent }}>
      {last ? null : (
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${indent} 10`} preserveAspectRatio="none">
          <line x1={lineX} y1={0} x2={lineX} y2={10} stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <svg className="absolute left-0 top-0 overflow-visible" width={indent} height={elbowY} viewBox={`0 0 ${indent} ${elbowY}`}>
        <path d={`M${lineX} ${last ? 0 : elbowY - r} V${elbowY - r} C${lineX} ${elbowY - r * 0.45} ${lineX + r * 0.45} ${elbowY} ${lineX + r} ${elbowY} H${indent + reach}`} fill="none" stroke="currentColor" strokeWidth={1.5} />
      </svg>
    </span>
  );
}

export function TreeBranch({ children, lineX = 15, elbowY = 16, indent = 34, radius = 6, reach = 0, className }: TreeBranchProps) {
  const items = Children.toArray(children);
  return (
    <div className={cn("flex flex-col", className)}>
      {items.map((child, index) => (
        <div key={(child as { key?: string }).key ?? index} className="relative" style={{ paddingLeft: indent }}>
          <Connector last={index === items.length - 1} lineX={lineX} elbowY={elbowY} indent={indent} radius={radius} reach={reach} />
          {child}
        </div>
      ))}
    </div>
  );
}
