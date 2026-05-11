"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { estimateFeatureAction } from "@/app/actions/estimations";
import type { FeatureToEstimate } from "@/app/actions/estimations";

interface Props {
  feature: FeatureToEstimate;
  open: boolean;
  onClose: () => void;
}

interface TaskDraft {
  // uid local uniquement pour le rendu React
  uid: string;
  title: string;
  days: string;
  description: string;
}

function newDraft(): TaskDraft {
  return {
    uid: crypto.randomUUID(),
    title: "",
    days: "",
    description: "",
  };
}

export function EstimationDialog({ feature, open, onClose }: Props) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskDraft[]>([newDraft()]);
  const [isPending, startTransition] = useTransition();

  const totalDays = tasks.reduce((sum, t) => {
    const d = parseFloat(t.days || "0");
    return sum + (Number.isFinite(d) && d > 0 ? d : 0);
  }, 0);

  const update = (uid: string, patch: Partial<TaskDraft>) => {
    setTasks((prev) => prev.map((t) => (t.uid === uid ? { ...t, ...patch } : t)));
  };

  const addRow = () => setTasks((prev) => [...prev, newDraft()]);

  const removeRow = (uid: string) =>
    setTasks((prev) => (prev.length === 1 ? prev : prev.filter((t) => t.uid !== uid)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation locale
    const cleaned = tasks.map((t) => ({
      title: t.title.trim(),
      days: parseFloat(t.days),
      description: t.description.trim(),
    }));

    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (c.title.length < 3) {
        toast.error(`Tâche ${i + 1} : titre trop court (min 3 caractères)`);
        return;
      }
      if (c.title.length > 200) {
        toast.error(`Tâche ${i + 1} : titre trop long (max 200 caractères)`);
        return;
      }
      if (!Number.isFinite(c.days) || c.days <= 0) {
        toast.error(`Tâche ${i + 1} : estimation en jours invalide`);
        return;
      }
      if (c.days > 30) {
        toast.error(`Tâche ${i + 1} : estimation > 30 jours, trop élevée`);
        return;
      }
    }

    startTransition(async () => {
      const res = await estimateFeatureAction({
        featureId: feature.id,
        tasks: cleaned.map((c) => ({
          title: c.title,
          estimatedDays: c.days,
          description: c.description.length > 0 ? c.description : undefined,
        })),
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          FEATURE_NOT_FOUND: "Feature introuvable",
          NOT_A_FEATURE: "Ce ticket n'est pas une Feature",
          ALREADY_ESTIMATED:
            "Cette feature a déjà été estimée (des tâches existent déjà)",
          RATE_LIMITED: "Trop de sessions rapides, patientez quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }

      toast.success(
        `Session terminée : ${res.createdCount} tâche${res.createdCount > 1 ? "s" : ""} créée${res.createdCount > 1 ? "s" : ""}`
      );
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" aria-hidden />
            Session d&apos;estimation
          </DialogTitle>
          <DialogDescription className="space-y-1">
            <span className="block">
              Feature{" "}
              <span className="font-mono text-foreground">{feature.key}</span> —{" "}
              <span className="font-medium text-foreground">{feature.title}</span>
            </span>
            <span className="block text-xs">
              Ajoutez toutes les tâches nécessaires à la réalisation de cette
              feature. Chaque tâche aura sa propre estimation en jours.
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto space-y-3 py-2">
            {tasks.map((t, idx) => (
              <div
                key={t.uid}
                className="border rounded-md p-3 bg-muted/20 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    Tâche {idx + 1}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => removeRow(t.uid)}
                    disabled={tasks.length === 1 || isPending}
                    aria-label="Supprimer cette tâche"
                    title="Supprimer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                  <div>
                    <Label htmlFor={`task-title-${t.uid}`}>Titre *</Label>
                    <Input
                      id={`task-title-${t.uid}`}
                      value={t.title}
                      onChange={(e) => update(t.uid, { title: e.target.value })}
                      placeholder="Ex : Créer le composant de paiement"
                      maxLength={200}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={`task-days-${t.uid}`}>Jours</Label>
                    <Input
                      id={`task-days-${t.uid}`}
                      type="number"
                      min={0.5}
                      max={30}
                      step={0.5}
                      value={t.days}
                      onChange={(e) => update(t.uid, { days: e.target.value })}
                      placeholder="0"
                      className="w-24"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor={`task-desc-${t.uid}`}>Description (optionnel)</Label>
                  <Textarea
                    id={`task-desc-${t.uid}`}
                    value={t.description}
                    onChange={(e) => update(t.uid, { description: e.target.value })}
                    placeholder="Contexte, critères d'acceptation…"
                    rows={2}
                    maxLength={5000}
                  />
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={tasks.length >= 50 || isPending}
              className="w-full gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter une tâche
            </Button>
          </div>

          <DialogFooter className="pt-4 border-t flex-row sm:justify-between items-center w-full">
            <p className="text-xs text-muted-foreground">
              {tasks.length} tâche{tasks.length > 1 ? "s" : ""} ·{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {totalDays.toFixed(1)}j
              </span>{" "}
              estimés au total
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={isPending}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={isPending} className="gap-1.5">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" />
                Terminer la session
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
