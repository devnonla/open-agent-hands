import { Button, Card, Tag, Tooltip, message } from "devnonla-ui";
import { Dices, LogOut } from "lucide-react";
import { useState } from "react";
import { apiClient } from "src/common/api";
import { fetchCurrentUser } from "src/common/authSlice";
import { cn } from "src/common/lib/cn";
import type { User } from "src/common/types";
import { UserAvatar, genConfig } from "src/components/UserAvatar";
import { useAppDispatch } from "src/store/store";

interface IdentityCardProps {
  user: User;
  avatar: string;
  onAvatarChange: (avatar: string) => void;
  onLogout: () => void;
}

function formatJoined(value: Date | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}

export function IdentityCard({ user, avatar, onAvatarChange, onLogout }: IdentityCardProps) {
  const dispatch = useAppDispatch();
  const [saving, setSaving] = useState(false);
  const name = user.name || user.username;

  const handleRandomize = async () => {
    const next = JSON.stringify(genConfig());
    onAvatarChange(next);

    setSaving(true);
    try {
      await apiClient.patch("/api/auth/update-profile", { avatar: next });
      await dispatch(fetchCurrentUser()).unwrap();
      message.success("Avatar updated");
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : "Failed to update avatar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="relative h-28 overflow-hidden rounded-t-xl bg-[radial-gradient(ellipse_at_50%_130%,color-mix(in_srgb,var(--brand)_55%,transparent),transparent_70%),linear-gradient(180deg,color-mix(in_srgb,var(--brand)_16%,transparent),transparent)]">
        <div className="absolute inset-0 bg-[radial-gradient(color-mix(in_srgb,var(--brand)_40%,transparent)_1px,transparent_1px)] bg-size-[14px_14px] mask-[linear-gradient(180deg,black,transparent)] opacity-70" />
      </div>

      <div className="flex flex-col items-center px-6 text-center">
        <div className="relative -mt-14">
          <div className="rounded-full bg-card p-1.5 ring-1 ring-border-secondary">
            <UserAvatar avatar={avatar} name={name} size={104} />
          </div>
          <Tooltip title="Shuffle avatar">
            <Button type="primary" shape="circle" aria-label="Shuffle avatar" disabled={saving} onClick={handleRandomize} icon={<Dices size={15} className={cn(saving && "animate-spin")} />} className="absolute right-0 bottom-1 border-2 border-card" />
          </Tooltip>
        </div>

        <h2 className="mt-4 mb-0 max-w-full truncate text-lg font-semibold leading-tight text-foreground">{name}</h2>
        <p className="mt-1 mb-0 max-w-full truncate text-sm text-muted-foreground">@{user.username}</p>
      </div>

      <div className="mx-6 mt-5 divide-y divide-border-secondary border-t border-border-secondary">
        <InfoRow label="Status">
          <Tag color={user.isActive ? "success" : "default"} dot>
            {user.isActive ? "Active" : "Inactive"}
          </Tag>
        </InfoRow>
        <InfoRow label="Joined">{formatJoined(user.createdAt)}</InfoRow>
      </div>

      <div className="mt-5 rounded-b-xl border-t border-border-secondary bg-muted px-5 py-4">
        <Button block icon={<LogOut size={14} />} onClick={onLogout}>
          Log out
        </Button>
      </div>
    </Card>
  );
}
