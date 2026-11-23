import { Card } from "devnonla-ui";
import type { FormEventHandler, ReactNode } from "react";

interface SectionCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  className?: string;
}

export function SectionCard({ title, description, children, footer, onSubmit, className }: SectionCardProps) {
  const card = (
    <Card title={title} caption={description} className={className}>
      <div className="flex flex-col gap-4 px-4 py-4">{children}</div>
      {footer ? <Card.Footer>{footer}</Card.Footer> : null}
    </Card>
  );
  return onSubmit ? <form onSubmit={onSubmit}>{card}</form> : card;
}
