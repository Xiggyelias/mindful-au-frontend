import { Shield } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type AnonymousModeToggleProps = {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function AnonymousModeToggle({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: AnonymousModeToggleProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50/70 px-2.5 py-1",
        className
      )}
    >
      <Shield className="h-3.5 w-3.5 text-rose-600" aria-hidden />
      <Label
        htmlFor={id}
        className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-rose-700"
      >
        <span className="hidden sm:inline">Anonymous mode</span>
        <span className="sm:hidden">Anon</span>
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label="Anonymous mode"
      />
    </div>
  );
}
