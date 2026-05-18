"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Filter, Loader2 } from "lucide-react";
import { KANBAN_TYPE_PRESETS } from "@/lib/tickets/hierarchy";

type PresetKey = keyof typeof KANBAN_TYPE_PRESETS;

interface Props {
  /** Preset selectionne actuellement (deduit de l'URL ou du defaut) */
  currentPreset: PresetKey;
}

/**
 * Selecteur de preset de filtres pour le Kanban.
 *
 * Visible uniquement pour les ADMIN qui ont acces a tous les types par defaut.
 * Permet de basculer rapidement entre :
 *   - "Tous les tickets" (par defaut)
 *   - "Pilotage (Epic + Feature)"
 *   - "Execution (Task + Bug + US)"
 *
 * Le filtre est encode dans l'URL via le parametre `?types=A,B,C` pour permettre
 * le partage de liens et la navigation arriere/avant.
 */
export function KanbanTypeFilter({ currentPreset }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const applyPreset = (preset: PresetKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (preset === "ALL") {
      // ALL = pas de filtre = pas de parametre URL
      params.delete("types");
    } else {
      params.set("types", KANBAN_TYPE_PRESETS[preset].types.join(","));
    }
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.push(url);
    });
  };

  return (
    <div
      className="inline-flex items-center gap-1 text-xs"
      title="Filtrer le Kanban par type de tickets (ADMIN uniquement)"
    >
      <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      <div className="inline-flex rounded-md border bg-background overflow-hidden">
        {(Object.keys(KANBAN_TYPE_PRESETS) as PresetKey[]).map((key) => {
          const preset = KANBAN_TYPE_PRESETS[key];
          const isActive = key === currentPreset;
          return (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              disabled={isPending}
              className={
                "px-2.5 py-1 transition-colors border-r last:border-r-0 " +
                (isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "hover:bg-accent")
              }
              title={preset.label}
            >
              {key === "ALL"
                ? "Tous"
                : key === "PILOTAGE"
                  ? "Pilotage"
                  : "Execution"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
