"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Valeur entre 0 et 100 */
  value?: number;
  /** Variante visuelle */
  tone?: "default" | "danger" | "success";
}

/**
 * Barre de progression accessible.
 * Utilisée dans : cartes Kanban, en-tête Test Runner, lignes Epic du dashboard.
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, tone = "default", ...props }, ref) => {
    const clamped = Math.max(0, Math.min(100, value));
    const fillColor =
      tone === "danger" ? "bg-destructive" : tone === "success" ? "bg-green-500" : "bg-primary";

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
        {...props}
      >
        <div
          className={cn("h-full transition-all duration-300", fillColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
