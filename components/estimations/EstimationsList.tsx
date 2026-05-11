"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckSquare, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { EstimationDialog } from "./EstimationDialog";
import type { FeatureToEstimate } from "@/app/actions/estimations";

interface Props {
  features: FeatureToEstimate[];
}

export function EstimationsList({ features }: Props) {
  const [estimating, setEstimating] = useState<FeatureToEstimate | null>(null);

  return (
    <>
      <section>
        <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">
          {features.length} feature{features.length > 1 ? "s" : ""}
        </h2>

        <ul className="border rounded-lg divide-y bg-card">
          {features.map((f) => (
            <li
              key={f.id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
            >
              <CheckSquare
                className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5"
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                  <Link
                    href={`/projects/${f.project.key}/board`}
                    className="hover:underline"
                  >
                    {f.project.key}
                  </Link>
                  <span>•</span>
                  <span className="font-mono">{f.key}</span>
                  {f.parent && (
                    <>
                      <span>•</span>
                      <span className="truncate">↖ {f.parent.key}</span>
                    </>
                  )}
                </div>
                <Link
                  href={`/tickets/${f.key}`}
                  className="text-sm font-medium hover:underline"
                >
                  {f.title}
                </Link>
                {f.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                    {f.description}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  Créé {formatDateTime(f.createdAt)}
                  {f.assignee && <> · Assigné à {f.assignee.name}</>}
                </p>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={() => setEstimating(f)}
                className="gap-1.5 shrink-0"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Estimer
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {estimating && (
        <EstimationDialog
          feature={estimating}
          open={!!estimating}
          onClose={() => setEstimating(null)}
        />
      )}
    </>
  );
}
