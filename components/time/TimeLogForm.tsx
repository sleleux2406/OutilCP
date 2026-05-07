"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { logTimeAction } from "@/app/actions/time";

interface Props {
  ticketId: string;
  /** Callback optionnel pour rafraîchir l'UI parente après succès */
  onLogged?: (totalMinutes: number) => void;
  /** Affichage compact (une seule ligne) pour intégration dans un footer de carte */
  compact?: boolean;
}

/**
 * Formulaire de log de temps (client). Utilise la Server Action logTimeAction.
 * Validation côté client alignée avec le schéma Zod côté serveur (dernière ligne
 * de défense reste côté serveur).
 */
export function TimeLogForm({ ticketId, onLogged, compact = false }: Props) {
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseInt(hours || "0", 10);
    const m = parseInt(minutes || "0", 10);
    const total = h * 60 + m;

    if (!Number.isFinite(total) || total <= 0) {
      toast.error("Durée invalide");
      return;
    }
    if (total > 1440) {
      toast.error("Maximum 24 heures par entrée");
      return;
    }

    startTransition(async () => {
      const res = await logTimeAction({
        ticketId,
        minutes: total,
        description: description.trim() || undefined,
      });
      if (!res.ok) {
        const msg =
          res.error === "FORBIDDEN"
            ? "Vous n'êtes pas autorisé à logger sur ce ticket"
            : res.error === "NOT_FOUND"
            ? "Ticket introuvable"
            : "Saisie invalide";
        toast.error(msg);
        return;
      }
      toast.success(`Temps logué (${total} min)`);
      setHours("");
      setMinutes("");
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
          max={24}
          placeholder="h"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="h-7 w-12 text-xs"
          aria-label="Heures"
        />
        <Input
          type="number"
          min={0}
          max={59}
          placeholder="min"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="h-7 w-14 text-xs"
          aria-label="Minutes"
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
          <Label htmlFor={`h-${ticketId}`}>Heures</Label>
          <Input
            id={`h-${ticketId}`}
            type="number"
            min={0}
            max={24}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`m-${ticketId}`}>Minutes</Label>
          <Input
            id={`m-${ticketId}`}
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor={`d-${ticketId}`}>Description (optionnelle)</Label>
        <Textarea
          id={`d-${ticketId}`}
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
