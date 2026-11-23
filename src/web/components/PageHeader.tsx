import { PageHeader as LibPageHeader } from "devnonla-ui";
import type { ReactNode } from "react";
import { cn } from "src/common/lib/cn";
import { FeatureIcon, type FeatureIconName } from "src/components/FeatureIcon";

export function PageHeader({ title, icon, description, actions, meta, bordered, children, className }: { title: string; icon?: FeatureIconName; description?: ReactNode; actions?: ReactNode; meta?: ReactNode; bordered?: boolean; children?: ReactNode; className?: string }) {
  return (
    <LibPageHeader
      className={cn("mb-6", className)}
      bordered={bordered}
      title={
        <span className="flex h-7 items-center gap-2.5 text-xl">
          {icon ? <FeatureIcon name={icon} size={24} variant="sticker" /> : null}
          {title}
        </span>
      }
      meta={meta}
      description={description ? <span className={cn("-mt-0.5 block", icon && "pl-[34px]")}>{description}</span> : description}
      extra={actions}
    >
      {children}
    </LibPageHeader>
  );
}
