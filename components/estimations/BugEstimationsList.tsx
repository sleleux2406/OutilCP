"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bug, ChevronRight, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { BugToEstimate } from "@/app/actions/estimations";
import { SimpleEstimateBugDialog } from "./SimpleEstimateBugDialog";
import { DecomposeBugDialog } from "./DecomposeBugDialog";

interface Props {
  bugs: BugToEstimate[];
}

/**
 * Liste des Bugs RUN à estimer. Pour chaque Bug, deux options :
 *   - "Estimer" : saisie directe d'une duree (Bug reste en mode feuille)
 *   - "Decomposer" : saisie de N Tasks (Bug bascule en mode container)
 */
export function BugEstimationsList({ bugs }: Props) {
  const router = useRouter();
  const [estimating, setEstimating] = useState<BugToEstimate | null>(null);
  const [decomposing, setDecomposing] = useState<BugToEstimate | null>(null);

  const handleSuccess = () => {
    setEstimating(null);
    setDecomposing(null);
    router.refresh();
  };

  if (bugs.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Bug className="h-4 w-4 text-red-500" aria-hidden />
          Bugs RUN à estimer
        </h2>
        <span className="text-xs text-muted-foreground">
          {bugs.length} bug{bugs.length > 1 ? "s" : ""}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Bugs issus de sous-projets RUN, ouverts et non encore chiffrés. Vous pouvez
        leur attribuer une estimation simple, ou les décomposer en plusieurs Tasks.
      </p>

      <ul className="border rounded-lg divide-y bg-card">
        {bugs.map((b) => (
          <li
            key={b.id}
            className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40"
          >
            <Bug className="h-4 w-4 text-red-500 shrink-0 mt-0.5" aria-hidden />
            <div className="flex-1 min-w-0">
              {/* Métadonnées : projet RUN • bug.key • parent (Feature) */}
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1">
                <Link
                  href={`/projects/${b.project.key}/board`}
                  className="font-mono hover:text-foreground"
                >
                  {b.project.key}
                </Link>
                {b.project.parentProject && (
                  <>
                    <span>↑</span>
                    <Link
                      href={`/projects/${b.project.parentProject.key}/board`}
                      className="hover:text-foreground"
                      title={b.project.parentProject.name}
                    >
                      {b.project.parentProject.key}
                    </Link>
                  </>
                )}
                <span>•</span>
                <span className="font-mono">{b.key}</span>
                {b.parent && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-0.5">
                      <span>↖</span>
                      <span className="font-mono">{b.parent.key}</span>
                    </span>
                  </>
                )}
                {b.priority <= 2 && (
                  <span
                    className={`inline-flex text-[10px] font-semibold px-1.5 rounded ${
                      b.priority === 1
                        ? "bg-red-500/15 text-red-600"
                        : "bg-amber-500/15 text-amber-600"
                    }`}
                  >
                    P{b.priority}
                  </span>
                )}
              </div>

              <Link
                href={`/tickets/${b.key}`}
                className="text-sm font-medium hover:underline block mt-0.5"
              >
                {b.title}
              </Link>
              {b.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {b.description}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                Créé {formatDateTime(b.createdAt)}
                {b.assignee && ` · Assigné à ${b.assignee.name}`}
              </p>
            </div>

            <div className="flex flex-col gap-1 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEstimating(b)}
                className="gap-1"
              >
                <Sparkles className="h-3 w-3" aria-hidden />
                Estimer
                <ChevronRight className="h-3 w-3" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDecomposing(b)}
                className="gap-1"
              >
                <Wand2 className="h-3 w-3" aria-hidden />
                Décomposer
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {estimating && (
        <SimpleEstimateBugDialog
          bug={estimating}
          open={!!estimating}
          onClose={() => setEstimating(null)}
          onSuccess={handleSuccess}
        />
      )}
      {decomposing && (
        <DecomposeBugDialog
          bug={decomposing}
          open={!!decomposing}
          onClose={() => setDecomposing(null)}
          onSuccess={handleSuccess}
        />
      )}
    </section>
  );
}
