"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { TicketType } from "@prisma/client";
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
import { TicketParentPicker } from "./TicketParentPicker";
import {
  createTicketAction,
  listAssignableUsersAction,
} from "@/app/actions/tickets";
import { PRIORITY_META, TICKET_TYPE_META } from "@/lib/tickets/metadata";

type CreatableType = "EPIC" | "FEATURE" | "USER_STORY";

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pré-sélection : type et parent quand ouvert depuis un contexte précis */
  defaultType?: CreatableType;
  defaultParentId?: string;
  /** Rôles permis pour restreindre le dropdown */
  allowedTypes: CreatableType[];
}

export function CreateTicketDialog({
  projectId,
  open,
  onOpenChange,
  defaultType,
  defaultParentId,
  allowedTypes,
}: Props) {
  const router = useRouter();

  const [type, setType] = useState<CreatableType>(defaultType ?? allowedTypes[0] ?? "EPIC");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string | null>(defaultParentId ?? null);
  const [priority, setPriority] = useState(3);
  const [estimatedHours, setEstimatedHours] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [assignableUsers, setAssignableUsers] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const [isPending, startTransition] = useTransition();

  const typeMeta = TICKET_TYPE_META[type as TicketType];
  const TypeIcon = typeMeta.icon;

  // Le parent est obligatoire sauf pour EPIC
  const needsParent = type !== "EPIC";

  // Quand le dialogue s'ouvre, on charge la liste des users assignables
  useEffect(() => {
    if (!open) return;
    listAssignableUsersAction()
      .then((res) => setAssignableUsers(res.users))
      .catch(() => setAssignableUsers([]));
  }, [open]);

  // Si on change de type et que ce nouveau type n'accepte pas de parent, on reset
  useEffect(() => {
    if (!needsParent) setParentId(null);
  }, [needsParent, type]);

  const reset = () => {
    setType(defaultType ?? allowedTypes[0] ?? "EPIC");
    setTitle("");
    setDescription("");
    setParentId(defaultParentId ?? null);
    setPriority(3);
    setEstimatedHours("");
    setAssigneeId("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) {
      toast.error("Le titre doit contenir au moins 3 caractères");
      return;
    }
    if (needsParent && !parentId) {
      toast.error("Veuillez choisir un parent");
      return;
    }

    const hours = parseFloat(estimatedHours || "0");
    const minutes = Number.isFinite(hours) ? Math.round(hours * 60) : 0;

    startTransition(async () => {
      const res = await createTicketAction({
        projectId,
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        parentId: parentId ?? null,
        priority,
        estimatedMinutes: minutes,
        assigneeId: assigneeId || null,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          FORBIDDEN: "Votre rôle ne permet pas de créer ce type de ticket",
          PARENT_NOT_FOUND: "Parent introuvable",
          INVALID_PARENT: "Ce parent ne peut pas accueillir ce type de ticket",
          CROSS_PROJECT: "Le parent n'appartient pas à ce projet",
          RATE_LIMITED: "Trop de créations rapides, réessayez dans quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`${TICKET_TYPE_META[type as TicketType].label} ${res.ticketKey} créé`);
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
            <TypeIcon className={`w-5 h-5 ${typeMeta.iconColor}`} aria-hidden />
            Nouveau ticket
          </DialogTitle>
          <DialogDescription>Créer un Epic, une Feature ou une User Story.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {/* Type */}
          <div>
            <Label htmlFor="ticket-type">Type *</Label>
            <Select
              id="ticket-type"
              value={type}
              onChange={(e) => setType(e.target.value as CreatableType)}
            >
              {allowedTypes.map((t) => (
                <option key={t} value={t}>
                  {TICKET_TYPE_META[t as TicketType].label}
                </option>
              ))}
            </Select>
          </div>

          {/* Parent (si applicable) */}
          {needsParent && (
            <div>
              <Label>
                Parent *{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  ({type === "FEATURE" ? "Epic" : "Feature"})
                </span>
              </Label>
              <TicketParentPicker
                projectId={projectId}
                childType={type as TicketType}
                value={parentId}
                onChange={setParentId}
              />
            </div>
          )}

          {/* Titre */}
          <div>
            <Label htmlFor="ticket-title">Titre *</Label>
            <Input
              id="ticket-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              minLength={3}
              placeholder="Titre court et descriptif"
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="ticket-description">Description</Label>
            <Textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={10_000}
              placeholder="Contexte, critères d'acceptation..."
            />
          </div>

          {/* Priorité + Estimation */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ticket-priority">Priorité</Label>
              <Select
                id="ticket-priority"
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
              <Label htmlFor="ticket-estimated">Estimé (heures)</Label>
              <Input
                id="ticket-estimated"
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

          {/* Assignee */}
          <div>
            <Label htmlFor="ticket-assignee">Assigné à</Label>
            <Select
              id="ticket-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">— Non assigné —</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </Select>
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
              <Plus className="h-4 w-4" />
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
