"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Clock, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { logTimeAction } from "@/app/actions/time";
import { MINUTES_PER_DAY, HOURS_PER_DAY, formatDays } from "@/lib/utils";

interface Props {
  ticketId: string;
  /** Callback optionnel pour rafraîchir l'UI parente après succès */
  onLogged?: (totalMinutes: number) => void;
  /** Affichage compact (une seule ligne) pour intégration dans un footer de carte */
  compact?: boolean;
  /**
   * Si true, le formulaire est remplacé par un message explicatif :
   * "Ce Bug a des Tasks chiffrées, loggez votre temps directement sur les Tasks"
   */
  bugIsContainer?: boolean;
}

/**
 * Formulaire de log de temps. Saisie en jours + heures (1 jour = 8h).
 * Max 24h par entrée, contrainte alignée avec CHECK SQL côté BDD.
 */
export function TimeLogForm({ ticketId, onLogged, compact = false, bugIsContainer = false }: Props) {
  const [days, setDays] = useState("");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();

  // Lot C1 : si le Bug est un container, on n'affiche pas le formulaire mais
  // un message invitant a logger sur les Tasks enfants.
  if (bugIsContainer) {
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/50 p-3 text-sm">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium text-blue-900 dark:text-blue-100">
              Log de temps désactivé sur ce Bug
            </p>
            <p className="text-xs text-blue-800 dark:text-blue-200">
              Ce Bug a des Tasks chiffrées en cours de réalisation. Loggez votre temps directement sur les Tasks dans la section "Tickets liés" ci-dessous, le total remontera automatiquement vers le Bug.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const d = parseFloat(days || "0");
    const h = parseFloat(hours || "0");

    if (!Number.isFinite(d) || !Number.isFinite(h) || d < 0 || h < 0) {
      toast.error("Durée invalide");
      return;
    }

    // Conversion : 1 jour = 8h, puis total en minutes
    const totalMinutes = Math.round(d * MINUTES_PER_DAY + h * 60);

    if (totalMinutes <= 0) {
      toast.error("Saisissez au moins quelques minutes");
      return;
    }
    if (totalMinutes > 30 * MINUTES_PER_DAY) {
      toast.error("Maximum 30 jours par entrée");
      return;
    }

    startTransition(async () => {
      const res = await logTimeAction({
        ticketId,
        minutes: totalMinutes,
        description: description.trim() || undefined,
      });
      if (!res.ok) {
        const msg =
          res.error === "FORBIDDEN"
            ? "Vous n'êtes pas autorisé à logger sur ce ticket"
            : res.error === "NOT_FOUND"
            ? "Ticket introuvable"
            : res.error === "TODO_TASK"
            ? "Impossible de logger du temps sur une tâche TODO (non chiffrée)"
            : res.error === "BUG_IS_CONTAINER"
            ? "Ce Bug a des Tasks chiffrées : loggez votre temps directement sur les Tasks"
            : "Saisie invalide";
        toast.error(msg);
        return;
      }
      toast.success(`Temps loggé (${formatDays(totalMinutes)})`);
      setDays("");
      setHours("");
      setDescription("");
      onLogged?.(res.totalLoggedMinutes);
    });
  };

  if (compact) {
    return (
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <Input
          type="number"
          min={0}
          max={30}
          step={0.5}
          placeholder="j"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="h-7 w-12 text-xs"
          aria-label="Jours"
        />
        <Input
          type="number"
          min={0}
          max={HOURS_PER_DAY}
          step={0.25}
          placeholder="h"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="h-7 w-14 text-xs"
          aria-label="Heures complémentaires"
        />
        <Button type="submit" size="sm" variant="outline" disabled={isPending} className="h-7 px-2">
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Logger"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`d-${ticketId}`}>Jours</Label>
          <Input
            id={`d-${ticketId}`}
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <Label htmlFor={`h-${ticketId}`}>Heures</Label>
          <Input
            id={`h-${ticketId}`}
            type="number"
            min={0}
            max={HOURS_PER_DAY}
            step={0.25}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-1">
        1 jour = {HOURS_PER_DAY}h · maximum 30 jours par entrée
      </p>

      <div>
        <Label htmlFor={`desc-${ticketId}`}>Description (optionnelle)</Label>
        <Textarea
          id={`desc-${ticketId}`}
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ce que vous avez fait..."
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Enregistrement...
          </>
        ) : (
          <>
            <Clock className="h-4 w-4" /> Logger le temps
          </>
        )}
      </Button>
    </form>
  );
}
