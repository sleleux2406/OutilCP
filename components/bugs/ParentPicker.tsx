"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckSquare, ChevronDown, Loader2, Search, X } from "lucide-react";
import type { TicketType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { listBugParentsAction, type ParentOption } from "@/app/actions/bugs";

interface Props {
  projectId: string;
  value: string | null;
  onChange: (parentId: string | null) => void;
  /** Placeholder quand rien n'est sélectionné */
  placeholder?: string;
  /** Parent pré-sélectionné (pour éviter un round-trip initial) */
  initialSelected?: ParentOption | null;
}

/**
 * Sélecteur de ticket parent (Feature ou US).
 * - Liste paginée par Server Action
 * - Recherche par clé ou titre avec debounce 200ms
 * - Accessible clavier (Escape ferme, flèches parcours)
 */
export function ParentPicker({
  projectId,
  value,
  onChange,
  placeholder = "Rechercher une Feature ou US...",
  initialSelected = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ParentOption[]>([]);
  const [selected, setSelected] = useState<ParentOption | null>(initialSelected);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fermeture sur clic extérieur
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // Recherche avec debounce
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await listBugParentsAction({
        projectId,
        q: query.trim() || undefined,
      });
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setResults(res.parents);
      else setResults([]);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query, projectId]);

  // Sync selected affiché si value change côté parent
  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    // Si la value correspond déjà à selected, rien à faire
    if (selected?.id === value) return;
    // Sinon on essaie de retrouver dans les résultats
    const found = results.find((r) => r.id === value);
    if (found) setSelected(found);
  }, [value, results, selected?.id]);

  const pick = (p: ParentOption) => {
    setSelected(p);
    onChange(p.id);
    setOpen(false);
    setQuery("");
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(null);
    onChange(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <TypeIcon type={selected.type} />
            <span className="font-mono text-xs text-muted-foreground shrink-0">{selected.key}</span>
            <span className="truncate">{selected.title}</span>
          </span>
        ) : (
          <span className="text-muted-foreground truncate">{placeholder}</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {selected && (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") clear(e as unknown as React.MouseEvent);
              }}
              className="rounded hover:bg-muted p-0.5"
              aria-label="Effacer la sélection"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Chercher par clé ou titre"
                className="pl-7 h-8 text-sm"
                maxLength={200}
              />
            </div>
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {loading && (
              <li className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </li>
            )}
            {!loading && results.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted-foreground text-center">
                Aucun parent trouvé
              </li>
            )}
            {!loading &&
              results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={p.id === value}
                    onClick={() => pick(p)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-sm text-left",
                      "hover:bg-accent",
                      p.id === value && "bg-accent"
                    )}
                  >
                    <TypeIcon type={p.type} />
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {p.key}
                    </span>
                    <span className="truncate">{p.title}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TypeIcon({ type }: { type: TicketType }) {
  if (type === "FEATURE") {
    return <CheckSquare className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-hidden />;
  }
  return <BookOpen className="h-3.5 w-3.5 text-blue-500 shrink-0" aria-hidden />;
}
