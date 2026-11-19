import { Dropdown, type MenuProps } from "devnonla-ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "src/common/lib/cn";

export function AgentsContentHeader({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
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

function CrumbLabel({ item }: { item: BreadcrumbItem }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {item.icon}
      <span className="truncate">{item.label}</span>
    </span>
  );
}

export function ContentBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center">
      {items.map((item, index) => {
        const current = index === items.length - 1;
        const body = <CrumbLabel item={item} />;
        return (
          <span key={`${item.label}-${index}`} className="flex min-w-0 items-center">
            {index > 0 ? <ChevronRight size={12} className="mx-1.5 shrink-0 text-muted-foreground/70" aria-hidden /> : null}
            {item.menu ? (
              <Dropdown menu={item.menu} trigger={["click"]} placement="bottomLeft">
                <button
                  type="button"
                  aria-current={current ? "page" : undefined}
                  aria-haspopup="menu"
                  aria-label={`Switch agent, ${item.label}`}
                  className={cn("flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 py-1 leading-none hover:bg-ink-hover", current ? "text-sm font-semibold text-foreground" : "text-sm font-medium text-muted-foreground hover:text-foreground")}
                >
                  {body}
                  <ChevronDown size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </Dropdown>
            ) : item.to && !current ? (
              <Link to={item.to} className="min-w-0 text-sm font-medium leading-none text-muted-foreground no-underline hover:text-foreground">
                {body}
              </Link>
            ) : (
              <span aria-current={current ? "page" : undefined} className={cn("min-w-0 text-sm leading-none", current ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
                {body}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
