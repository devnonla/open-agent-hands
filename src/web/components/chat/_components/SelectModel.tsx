import { ChevronDown } from "lucide-react";
import { cn } from "src/common/lib/cn";
import { ModelPicker, shortModelName } from "src/components/ModelPicker";

interface SelectModelProps {
  providerId?: string | null;
  model?: string;
  disabled?: boolean;
  emptyLabel?: string;
  allowInherit?: boolean;
  onChange?: (providerId: string, model: string) => void;
  onInherit?: () => void;
}

export function SelectModel({ providerId, model, disabled, emptyLabel, allowInherit, onChange, onInherit }: SelectModelProps) {
  return (
    <ModelPicker
      selectedProviderId={providerId ?? null}
      selectedModel={model ?? ""}
      disabled={disabled}
      allowInherit={allowInherit}
      onInherit={onInherit}
      onChange={(pid, m) => onChange?.(pid, m)}
      className="w-fit"
      matchTriggerWidth={false}
      popoverSide="top"
      popoverClassName="w-72 h-80 p-0 overflow-hidden"
      renderTrigger={({ model: selectedModel, open }) => {
        const shown = selectedModel ? shortModelName(selectedModel) : (emptyLabel ?? "Select model");
        const filled = Boolean(selectedModel || emptyLabel);
        return (
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-5.5 items-center gap-1.5 rounded-full px-1.5 font-normal leading-none transition-all duration-150 outline-none",
              disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
              open ? "bg-border/70 text-foreground" : filled ? "text-foreground/90 hover:bg-border/60" : "border border-dashed border-border text-muted-foreground hover:bg-muted hover:border-border",
            )}
          >
            <span className="truncate text-[12px] font-normal leading-none">{shown}</span>
            <ChevronDown size={9} className={cn("shrink-0 transition-transform duration-150", open ? "rotate-180 text-foreground" : "text-border-hover")} />
          </button>
        );
      }}
    />
  );
}
