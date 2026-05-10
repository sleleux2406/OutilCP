"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { deleteTicketAction } from "@/app/actions/tickets";

interface Props {
  ticketId: string;
  ticketKey: string;
  ticketTitle: string;
  userRole: Role;
}

/**
 * Menu "..." avec actions sur le ticket (suppression pour l'instant).
 * Visible uniquement pour ADMIN et PRODUCT_OWNER.
 */
export function TicketActionsMenu({ ticketId, ticketKey, ticketTitle, userRole }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  const canDelete = userRole === "ADMIN" || userRole === "PRODUCT_OWNER";

  // Fermer menu au clic extérieur
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  if (!canDelete) return null;

  const openConfirm = () => {
    setMenuOpen(false);
    setConfirmText("");
    setConfirmOpen(true);
  };

  const doDelete = () => {
    if (confirmText !== ticketKey) {
      toast.error(`Tapez exactement "${ticketKey}" pour confirmer`);
      return;
    }
    startTransition(async () => {
      const res = await deleteTicketAction({ ticketId });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          FORBIDDEN: "Vous n'êtes pas autorisé à supprimer ce ticket",
          NOT_FOUND: "Ticket introuvable",
          HAS_CHILDREN:
            "Ce ticket a des enfants. Supprimez-les d'abord, puis réessayez.",
          HAS_EXECUTIONS:
            "Des cas de test de ce ticket ont déjà été exécutés. Suppression refusée pour préserver l'historique.",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`Ticket ${ticketKey} supprimé`);
      setConfirmOpen(false);
      // Redirige vers le board du projet
      router.push(`/projects/${res.projectKey}/board`);
      router.refresh();
    });
  };

  return (
    <>
      <div ref={containerRef} className="relative">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Actions sur le ticket"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
        </Button>

        {menuOpen && (
          <ul
            role="menu"
            className="absolute right-0 z-50 mt-1 min-w-[180px] bg-popover border rounded-md shadow-lg py-1"
          >
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={openConfirm}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Supprimer le ticket
              </button>
            </li>
          </ul>
        )}
      </div>

      {/* Dialogue de confirmation */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !isPending && setConfirmOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" aria-hidden />
              Supprimer ce ticket ?
            </DialogTitle>
            <DialogDescription>
              Cette action est <strong>irréversible</strong>. Les données suivantes seront
              supprimées :
              <ul className="list-disc pl-5 mt-2 text-xs">
                <li>Le ticket <strong className="font-mono">{ticketKey}</strong> — {ticketTitle}</li>
                <li>Tous les cas de test et time entries liés</li>
                <li>Toutes les pièces jointes</li>
              </ul>
              <p className="mt-2 text-xs">
                Si le ticket a des enfants ou des exécutions de test, la suppression sera
                refusée.
              </p>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="confirm-key" className="text-sm font-medium">
              Tapez <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">{ticketKey}</code>{" "}
              pour confirmer :
            </label>
            <input
              id="confirm-key"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={doDelete}
              disabled={isPending || confirmText !== ticketKey}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Supprimer définitivement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
