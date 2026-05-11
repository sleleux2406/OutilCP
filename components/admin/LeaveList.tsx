"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import { createLeaveAction, deleteLeaveAction } from "@/app/actions/leaves";

interface Leave {
  id: string;
  startDate: string;
  endDate: string;
  label: string | null;
}

interface Props {
  userId: string;
  initialLeaves: Leave[];
}

export function LeaveList({ userId, initialLeaves }: Props) {
  const router = useRouter();
  const [leaves, setLeaves] = useState<Leave[]>(initialLeaves);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [label, setLabel] = useState("");
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const addLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      toast.error("Choisissez les deux dates");
      return;
    }
    if (endDate < startDate) {
      toast.error("La date de fin doit être après la date de début");
      return;
    }

    setPendingOp("add");
    startTransition(async () => {
      const res = await createLeaveAction({
        userId,
        startDate,
        endDate,
        label: label.trim() || undefined,
      });
      setPendingOp(null);
      if (!res.ok) {
        const msg = {
          VALIDATION: "Dates invalides",
          FORBIDDEN: "Vous n'avez pas les droits pour cette action",
          USER_NOT_FOUND: "Utilisateur introuvable",
          OVERLAP: "Cette plage chevauche un congé existant",
          RATE_LIMITED: "Trop de créations rapides, réessayez dans quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success("Congé ajouté");
      setStartDate("");
      setEndDate("");
      setLabel("");
      router.refresh();
    });
  };

  const removeLeave = (leave: Leave) => {
    const range = `${formatDate(leave.startDate)} → ${formatDate(leave.endDate)}`;
    const name = leave.label ? `"${leave.label}" (${range})` : range;
    if (!confirm(`Supprimer ce congé ${name} ?`)) return;

    setPendingOp(`del-${leave.id}`);
    startTransition(async () => {
      const res = await deleteLeaveAction({ id: leave.id });
      setPendingOp(null);
      if (!res.ok) {
        toast.error(
          res.error === "FORBIDDEN"
            ? "Vous n'avez pas les droits pour cette action"
            : res.error === "NOT_FOUND"
            ? "Congé introuvable"
            : "Suppression impossible"
        );
        return;
      }
      setLeaves((prev) => prev.filter((x) => x.id !== leave.id));
      toast.success("Congé supprimé");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={addLeave}
        className="border rounded-lg p-4 bg-card space-y-3"
      >
        <h2 className="text-sm font-semibold">Ajouter une plage de congés</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="leave-start">Du</Label>
            <Input
              id="leave-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="leave-end">Au</Label>
            <Input
              id="leave-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              required
            />
          </div>
          <div>
            <Label htmlFor="leave-label">Libellé (optionnel)</Label>
            <Input
              id="leave-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Vacances été, RTT…"
              maxLength={200}
            />
          </div>
        </div>
        <div className="flex justify-end">
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

      <section>
        <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">
          {leaves.length} plage{leaves.length > 1 ? "s" : ""} de congés
        </h2>

        {leaves.length === 0 ? (
          <p className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
            Aucun congé planifié.
          </p>
        ) : (
          <ul className="border rounded-lg divide-y bg-card">
            {leaves.map((l) => {
              const pending = pendingOp === `del-${l.id}`;
              const multi = l.startDate !== l.endDate;
              return (
                <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                  <time
                    dateTime={l.startDate}
                    className="font-mono text-sm tabular-nums text-muted-foreground shrink-0"
                  >
                    {formatDate(l.startDate)}
                    {multi && <> → {formatDate(l.endDate)}</>}
                  </time>
                  <span className="flex-1 text-sm">{l.label ?? "—"}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeLeave(l)}
                    disabled={pending}
                    aria-label="Supprimer ce congé"
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
