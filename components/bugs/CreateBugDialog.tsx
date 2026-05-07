"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bug, Loader2 } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { ParentPicker } from "./ParentPicker";
import { createFreeBugAction } from "@/app/actions/bugs";
import { PRIORITY_META } from "@/lib/tickets/metadata";

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Parent pré-sélectionné si ouvert depuis un ticket */
  defaultParentId?: string;
}

export function CreateBugDialog({ projectId, open, onOpenChange, defaultParentId }: Props) {
  const router = useRouter();

  const [parentId, setParentId] = useState<string | null>(defaultParentId ?? null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(3);
  const [estimatedHours, setEstimatedHours] = useState("");
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setParentId(defaultParentId ?? null);
    setTitle("");
    setDescription("");
    setPriority(3);
    setEstimatedHours("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parentId) {
      toast.error("Choisissez une Feature ou une User Story");
      return;
    }
    if (title.trim().length < 3) {
      toast.error("Le titre doit contenir au moins 3 caractères");
      return;
    }

    const hours = parseFloat(estimatedHours || "0");
    const minutes = Number.isFinite(hours) ? Math.round(hours * 60) : 0;

    startTransition(async () => {
      const res = await createFreeBugAction({
        projectId,
        parentId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        estimatedMinutes: minutes,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          PARENT_NOT_FOUND: "Parent introuvable",
          INVALID_PARENT: "Ce ticket ne peut pas accueillir un bug",
          CROSS_PROJECT: "Le parent n'appartient pas à ce projet",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`Bug ${res.bugKey} créé`);
      reset();
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="w-5 h-5 text-red-500" aria-hidden />
            Nouveau bug
          </DialogTitle>
          <DialogDescription>
            Rattachez-le à une Feature ou une User Story du projet.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Rattacher à *</Label>
            <ParentPicker projectId={projectId} value={parentId} onChange={setParentId} />
          </div>

          <div>
            <Label htmlFor="bug-title">Titre *</Label>
            <Input
              id="bug-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              minLength={3}
              placeholder="Courte description du problème"
            />
          </div>

          <div>
            <Label htmlFor="bug-description">Description (markdown accepté)</Label>
            <Textarea
              id="bug-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={10_000}
              placeholder="Reproduction, environnement, piste de résolution..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bug-priority">Priorité</Label>
              <Select
                id="bug-priority"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              >
                {Object.entries(PRIORITY_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bug-estimated">Estimé (heures)</Label>
              <Input
                id="bug-estimated"
                type="number"
                min={0}
                max={720}
                step={0.25}
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Créer le bug
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
