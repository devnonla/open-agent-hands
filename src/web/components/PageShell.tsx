import type { ReactNode } from "react";
import { cn } from "src/common/lib/cn";

export const PAGE_GUTTER = "px-3 sm:px-6 lg:px-10";

export function PageBand({ header, tabs, className, width = "max-w-5xl" }: { header: ReactNode; tabs?: ReactNode; className?: string; width?: string }) {
  return (
    <div className={cn("shrink-0 border-b border-border bg-card", PAGE_GUTTER, className)}>
      <div className={cn("mx-auto w-full pt-5", width, tabs ? "pb-0" : "pb-5")}>
        {header}
        {tabs ? <div className="-mb-px mt-3 [&_.h-px]:hidden [&_[role=tablist]]:gap-5">{tabs}</div> : null}
      </div>
    </div>
  );
}

export function PageScroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}>{children}</div>;
}

export function PageShell({
  children,
  className,
  contentClassName,
  header,
  tabs,
  fill = false,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  header?: ReactNode;
  tabs?: ReactNode;
  fill?: boolean;
}) {
  if (!header) {
    return (
      <div className={cn("pt-4 pb-8 in-data-expanded:pb-0", PAGE_GUTTER, className)}>
        <div className={cn("mx-auto w-full max-w-5xl", contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <PageBand header={header} tabs={tabs} />
      <PageScroll className={cn("flex flex-col pt-5 pb-8 in-data-expanded:pb-0", PAGE_GUTTER, fill && "overflow-hidden")}>
        <div className={cn("@container mx-auto flex w-full max-w-5xl flex-1 flex-col", fill && "min-h-0", contentClassName)}>{children}</div>
      </PageScroll>
    </div>
  );
}
