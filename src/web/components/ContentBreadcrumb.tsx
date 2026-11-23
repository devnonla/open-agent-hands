import { Breadcrumb, Dropdown, type MenuProps, Icon } from "devnonla-ui";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function ContentHeader({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
      <div className="min-w-0 flex-1">{left}</div>
      {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
    </header>
  );
}

export type BreadcrumbItem = {
  label: string;
  to?: string;
  icon?: ReactNode;
  menu?: MenuProps;
};

export function ContentBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const navigate = useNavigate();
  return (
    <Breadcrumb
      className="min-w-0 [&_li]:flex [&_li]:items-center [&_li]:shrink-0 [&_li:last-child]:min-w-0 [&_li:last-child]:shrink [&_li:last-child>*]:max-w-full [&_li:not(:last-child)]:max-w-48"
      items={items.map((item) => ({
        icon: item.icon,
        title: item.menu ? (
          <Dropdown menu={item.menu} trigger={["click"]} placement="bottomLeft">
            <span role="button" tabIndex={0} aria-haspopup="menu" aria-label={`Switch, ${item.label}`} className="inline-flex cursor-pointer items-center gap-1">
              {item.label}
              <Icon name="arrow-down" size={12} className="shrink-0 text-muted-foreground" />
            </span>
          </Dropdown>
        ) : (
          item.label
        ),
        ...(item.to && !item.menu ? { href: item.to, onClick: () => navigate(item.to as string) } : {}),
      }))}
    />
  );
}
