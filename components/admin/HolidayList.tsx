"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import {
  createHolidayAction,
  deleteHolidayAction,
} from "@/app/actions/holidays";

interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
}

interface Props {
  initialHolidays: Holiday[];
}

export function HolidayList({ initialHolidays }: Props) {
  const router = useRouter();
  const [holidays, setHolidays] = useState<Holiday[]>(initialHolidays);
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const addHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate) {
      toast.error("Choisissez une date");
      return;
    }
    if (newLabel.trim().length === 0) {
      toast.error("Saisissez un libellé");
      return;
    }

    setPendingOp("add");
    startTransition(async () => {
      const res = await createHolidayAction({
        date: newDate,
        label: newLabel.trim(),
      });
      setPendingOp(null);
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          DUPLICATE: "Un jour férié existe déjà pour cette date",
          RATE_LIMITED: "Trop de créations rapides, réessayez dans quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success("Jour férié ajouté");
      setNewDate("");
      setNewLabel("");
      router.refresh();
    });
  };

  const removeHoliday = (h: Holiday) => {
    if (!confirm(`Supprimer le jour férié "${h.label}" (${formatDate(h.date)}) ?`)) {
      return;
    }
    setPendingOp(`del-${h.id}`);
    startTransition(async () => {
      const res = await deleteHolidayAction({ id: h.id });
      setPendingOp(null);
      if (!res.ok) {
        toast.error(
          res.error === "NOT_FOUND" ? "Jour férié introuvable" : "Suppression impossible"
        );
        return;
      }
      setHolidays((prev) => prev.filter((x) => x.id !== h.id));
      toast.success("Jour férié supprimé");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Formulaire d'ajout */}
      <form
        onSubmit={addHoliday}
        className="border rounded-lg p-4 bg-card space-y-3"
      >
        <h2 className="text-sm font-semibold">Ajouter un jour férié</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-3 items-end">
          <div>
            <Label htmlFor="holiday-date">Date</Label>
            <Input
              id="holiday-date"
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              required
              className="sm:w-44"
            />
          </div>
          <div>
            <Label htmlFor="holiday-label">Libellé</Label>
            <Input
              id="holiday-label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Ex : 1er mai, Fête nationale..."
              maxLength={200}
              required
            />
          </div>
          <Button type="submit" disabled={pendingOp === "add"} className="gap-1.5">
            {pendingOp === "add" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Ajouter
          </Button>
        </div>
      </form>

      {/* Liste */}
      <section>
        <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">
          {holidays.length} jour{holidays.length > 1 ? "s" : ""} férié
          {holidays.length > 1 ? "s" : ""}
        </h2>

        {holidays.length === 0 ? (
          <p className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
            Aucun jour férié pour l&apos;instant. Ajoutez-en depuis le formulaire ci-dessus.
          </p>
        ) : (
          <ul className="border rounded-lg divide-y bg-card">
            {holidays.map((h) => {
              const pending = pendingOp === `del-${h.id}`;
              return (
                <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                  <time
                    dateTime={h.date}
                    className="font-mono text-sm tabular-nums text-muted-foreground shrink-0 w-28"
                  >
                    {formatDate(h.date)}
                  </time>
                  <span className="flex-1 text-sm">{h.label}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeHoliday(h)}
                    disabled={pending}
                    aria-label={`Supprimer ${h.label}`}
                    className="h-7 w-7 hover:text-destructive"
                  >
                    {pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
