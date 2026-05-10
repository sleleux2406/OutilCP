"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TicketStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { TICKET_STATUS_META } from "@/lib/tickets/metadata";
import { updateTicketStatusAction } from "@/app/actions/tickets";

interface Props {
  ticketId: string;
  currentStatus: TicketStatus;
  /** Si false, affiche juste le badge en lecture seule */
  canEdit: boolean;
}

const STATUSES: TicketStatus[] = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "IN_TESTING",
  "DONE",
  "BLOCKED",
];

/**
 * Dropdown pour changer l'état du ticket directement depuis sa page.
 * Affiche le badge statut coloré, cliquable si canEdit.
 */
export function TicketStatusPicker({ ticketId, currentStatus, canEdit }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<TicketStatus>(currentStatus);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync si le statut remonte d'un revalidate
  useEffect(() => {
    setStatus(currentStatus);
  }, [currentStatus]);

  // Fermer au clic extérieur
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
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

  const pick = (next: TicketStatus) => {
    if (next === status) {
      setOpen(false);
      return;
    }
    const previous = status;
    setStatus(next); // optimistic
    setOpen(false);

    startTransition(async () => {
      const res = await updateTicketStatusAction({ ticketId, status: next });
      if (!res.ok) {
        setStatus(previous); // rollback
        const msg = {
          VALIDATION: "Statut invalide",
          FORBIDDEN: "Vous n'êtes pas autorisé à modifier ce ticket",
          NOT_FOUND: "Ticket introuvable",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`Statut mis à jour : ${TICKET_STATUS_META[next].label}`);
      router.refresh();
    });
  };

  const currentMeta = TICKET_STATUS_META[status];

  // Lecture seule : on affiche juste le badge
  if (!canEdit) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
          getBadgeClass(currentMeta.badgeVariant)
        )}
      >
        <span className={cn("w-1.5 h-1.5 rounded-full", currentMeta.dotColor)} />
        {currentMeta.label}
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Changer le statut"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
          "hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          getBadgeClass(currentMeta.badgeVariant),
          isPending && "opacity-60"
        )}
      >
        <span className={cn("w-1.5 h-1.5 rounded-full", currentMeta.dotColor)} />
        {currentMeta.label}
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-1 min-w-[180px] bg-popover border rounded-md shadow-lg py-1"
        >
          {STATUSES.map((s) => {
            const meta = TICKET_STATUS_META[s];
            const isSelected = s === status;
            return (
              <li key={s}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => pick(s)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent",
                    isSelected && "bg-accent"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", meta.dotColor)} />
                  <span className="flex-1">{meta.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function getBadgeClass(
  variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"
): string {
  switch (variant) {
    case "success":
      return "bg-green-500/15 text-green-700 dark:text-green-400 border-transparent";
    case "warning":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent";
    case "destructive":
      return "bg-destructive text-destructive-foreground border-transparent";
    case "info":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-transparent";
    case "secondary":
      return "bg-secondary text-secondary-foreground border-transparent";
    default:
      return "border text-foreground";
  }
}
