import { Button, Card } from "devnonla-ui";
import { LogOut } from "lucide-react";
import type { User } from "src/common/types";
import { UserAvatar } from "src/components/UserAvatar";

interface IdentityCardProps {
  user: User;
  onLogout: () => void;
}

export function IdentityCard({ user, onLogout }: IdentityCardProps) {
  const name = user.name || user.username;
  return (
    <Card>
      <div className="relative h-28 overflow-hidden rounded-t-xl bg-[radial-gradient(ellipse_at_50%_130%,color-mix(in_srgb,var(--brand)_55%,transparent),transparent_70%),linear-gradient(180deg,color-mix(in_srgb,var(--brand)_16%,transparent),transparent)]">
        <div className="absolute inset-0 bg-[radial-gradient(color-mix(in_srgb,var(--brand)_40%,transparent)_1px,transparent_1px)] bg-size-[14px_14px] mask-[linear-gradient(180deg,black,transparent)] opacity-70" />
      </div>

      <div className="flex flex-col items-center px-6 text-center">
        <div className="relative -mt-14 rounded-full bg-card p-1.5 ring-1 ring-border-secondary">
          <UserAvatar size={104} />
        </div>

        <h2 className="mt-4 mb-0 max-w-full truncate text-lg font-semibold leading-tight text-foreground">{name}</h2>
        <p className="mt-1 mb-0 max-w-full truncate text-sm text-muted-foreground">@{user.username}</p>
      </div>

      <div className="mt-5 rounded-b-xl border-t border-border-secondary bg-muted px-5 py-4">
        <Button block icon={<LogOut size={14} />} onClick={onLogout}>
          Log out
        </Button>
      </div>
    </Card>
  );
}
