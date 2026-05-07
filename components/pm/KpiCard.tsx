import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiTone = "primary" | "success" | "warning" | "danger" | "neutral";

interface Props {
  icon: LucideIcon;
  label: string;
  value: string | number;
  /** Indication secondaire sous la valeur (% ou détail) */
  hint?: string;
  tone?: KpiTone;
}

const TONE_CLASSES: Record<KpiTone, string> = {
  primary: "text-primary bg-primary/10",
  success: "text-green-600 bg-green-500/10 dark:text-green-400",
  warning: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
  danger: "text-destructive bg-destructive/10",
  neutral: "text-muted-foreground bg-muted",
};

export function KpiCard({ icon: Icon, label, value, hint, tone = "primary" }: Props) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            "w-8 h-8 rounded-md grid place-items-center shrink-0",
            TONE_CLASSES[tone]
          )}
          aria-hidden
        >
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-xs text-muted-foreground uppercase tracking-wide truncate">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1 truncate">{hint}</div>}
    </div>
  );
}
