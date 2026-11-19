import type { ReactNode } from "react";
import { cn } from "src/common/lib/cn";
import { FeatureIcon, type FeatureIconName } from "src/components/FeatureIcon";

/** Title row for list pages: heading, optional description, optional controls, actions on the right. */
export function PageHeader({
  title,
  icon,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  icon?: FeatureIconName;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const stacked = description != null || children != null;

  return (
    <div className={cn("mb-8 flex flex-wrap justify-between gap-4", stacked ? "items-end" : "items-center", className)}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon ? <FeatureIcon name={icon} size={26} variant="sticker" /> : null}
          <h1 className="m-0 truncate text-xl font-semibold leading-tight text-foreground">{title}</h1>
        </div>
        {description ? <p className={cn("mt-1 mb-0 text-sm text-muted-foreground", icon && "ps-9")}>{description}</p> : null}
        {children ? <div className={cn("mt-3", icon && "ps-9")}>{children}</div> : null}
      </div>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
