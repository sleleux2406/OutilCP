"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Wrench, Loader2 } from "lucide-react";
import { parseTechnicalFilter } from "@/lib/tickets/hierarchy";

type TechnicalState = "all" | "technical" | "functional";

interface Props {
  /** Etat actuel du filtre, deduit de l'URL ?technical=... */
  current: TechnicalState;
}

/**
 * Selecteur de filtre 'Technique / Fonctionnel / Tous' pour le Kanban.
 *
 * Visible pour ADMIN/PO (les developpeurs/testeurs voient tous les tickets,
 * sans distinction technique vs fonctionnel).
 *
 * Le filtre est encode dans l'URL via `?technical=true|false` pour permettre
 * le partage de liens et la navigation arriere/avant.
 */
export function KanbanTechnicalFilter({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const apply = (state: TechnicalState) => {
    const params = new URLSearchParams(searchParams.toString());
    if (state === "all") {
      params.delete("technical");
    } else if (state === "technical") {
      params.set("technical", "true");
    } else {
      params.set("technical", "false");
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
      title="Filtrer par categorie technique vs fonctionnelle"
    >
      <Wrench className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      <div className="inline-flex rounded-md border bg-background overflow-hidden">
        <FilterButton
          active={current === "all"}
          onClick={() => apply("all")}
          disabled={isPending}
          label="Tous"
          title="Aucun filtre technique"
        />
        <FilterButton
          active={current === "functional"}
          onClick={() => apply("functional")}
          disabled={isPending}
          label="Fonctionnel"
          title="Uniquement les tickets fonctionnels"
        />
        <FilterButton
          active={current === "technical"}
          onClick={() => apply("technical")}
          disabled={isPending}
          label="Technique"
          title="Uniquement les tickets techniques (refactor, infra, dette)"
        />
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  disabled,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-2.5 py-1 transition-colors border-r last:border-r-0 disabled:opacity-50 " +
        (active
          ? "bg-primary text-primary-foreground font-medium"
          : "hover:bg-accent")
      }
      title={title}
    >
      {label}
    </button>
  );
}

/**
 * Helper : determine l'etat actif depuis le parametre URL.
 */
export function getCurrentTechnicalState(
  raw: string | null | undefined
): TechnicalState {
  const parsed = parseTechnicalFilter(raw);
  if (parsed === true) return "technical";
  if (parsed === false) return "functional";
  return "all";
}
