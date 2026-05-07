"use client";

import { Bug, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { GeneratedBug } from "./TestRunner";

interface Props {
  bug: GeneratedBug | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Drawer latéral de prévisualisation du bug généré automatiquement.
 * Version simplifiée : on affiche les infos clés + lien vers le ticket complet.
 * L'édition approfondie se fait sur la page /tickets/[key] (lot 9).
 */
export function BugPreviewDrawer({ bug, open, onClose }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader className="border-b pb-3">
          <div className="flex items-center gap-2">
            <Bug className="w-5 h-5 text-red-500" aria-hidden />
            <SheetTitle className="font-mono text-base">{bug?.key ?? "—"}</SheetTitle>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {bug ? (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Titre
                </p>
                <p className="text-sm font-medium">{bug.title}</p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Créé depuis le cas
                </p>
                <p className="text-sm italic">{bug.forTestCase}</p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Ticket source (maintenant bloqué)
                </p>
                <p className="text-sm font-mono">{bug.parentKey}</p>
              </div>

              <div className="pt-3 border-t text-xs text-muted-foreground">
                Ouvrez le ticket complet pour enrichir la description, ajouter des étapes de
                reproduction ou assigner un développeur.
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun bug à afficher.</p>
          )}
        </div>

        <SheetFooter className="border-t pt-3 flex-row justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Retour au test
          </Button>
          {bug && (
            <Button asChild>
              <Link href={bug.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Ouvrir le ticket
              </Link>
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
