import type { ReactNode } from "react";
import { cn } from "src/common/lib/cn";

export function PageBand({ header, tabs, className, width = "max-w-5xl" }: { header: ReactNode; tabs?: ReactNode; className?: string; width?: string }) {
  return (
    <div className={cn("shrink-0 border-b border-border bg-card px-10", className)}>
      <div className={cn("mx-auto w-full pt-5", width, tabs ? "pb-0" : "pb-5")}>
        {header}
        {tabs ? <div className="-mb-px mt-3 [&_.h-px]:hidden [&_[role=tablist]]:gap-5">{tabs}</div> : null}
      </div>
    </div>
  );
}

/** Shared content rail for AppLayout pages — keeps max-width and gutters aligned. */
export function PageShell({
  children,
  className,
  contentClassName,
  header,
  tabs,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  header?: ReactNode;
  tabs?: ReactNode;
}) {
  if (!header) {
    return (
      <div className={cn("pt-4 pb-8 px-10 in-data-expanded:pb-0", className)}>
        <div className={cn("mx-auto w-full max-w-5xl", contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-full flex-col", className)}>
      <PageBand header={header} tabs={tabs} />
      <div className="flex min-h-0 flex-1 flex-col px-10 pt-5 pb-8 in-data-expanded:pb-0">
        <div className={cn("mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col", contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
