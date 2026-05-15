"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  estimateBugSimpleAction,
  type BugToEstimate,
} from "@/app/actions/estimations";

interface Props {
  bug: BugToEstimate;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Dialog d'estimation simple d'un Bug : saisie directe d'une duree en jours.
 * Le Bug reste en mode feuille (pas de Tasks creees).
 */
export function SimpleEstimateBugDialog({ bug, open, onClose, onSuccess }: Props) {
  const [days, setDays] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const d = parseFloat(days || "0");
    if (!Number.isFinite(d) || d <= 0) {
      toast.error("Saisissez une durée positive");
      return;
    }
    if (d > 30) {
      toast.error("Maximum 30 jours par bug");
      return;
    }

    startTransition(async () => {
      const res = await estimateBugSimpleAction({
        bugId: bug.id,
        estimatedDays: d,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          BUG_NOT_FOUND: "Bug introuvable",
          NOT_A_BUG: "Ce ticket n'est pas un Bug",
          ALREADY_ESTIMATED: "Ce Bug a déjà une estimation",
          ALREADY_LOGGED: "Du temps a déjà été loggé sur ce Bug, l'estimation est verrouillée",
          RATE_LIMITED: "Trop de saisies rapides, réessayez dans quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`${bug.key} estimé à ${d}j`);
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" aria-hidden />
            Estimer le Bug {bug.key}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">{bug.title}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="bug-estim-days">Estimation (jours) *</Label>
            <Input
              id="bug-estim-days"
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="0.5"
              required
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              1 jour = 8 heures · maximum 30 jours
            </p>
          </div>

          <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2.5">
            Le Bug restera en mode "feuille" : son estimation sera figée et le temps
            sera loggé directement sur lui. Si vous voulez plutôt le décomposer en
            plusieurs sous-Tasks, fermez ce dialog et utilisez le bouton "Décomposer".
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Sparkles className="h-4 w-4" />
              Enregistrer l'estimation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
