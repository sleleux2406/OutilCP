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
import { daysToMinutes, MINUTES_PER_DAY } from "@/lib/utils";

type CreatableType = "EPIC" | "FEATURE" | "USER_STORY" | "TASK";

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pré-sélection : type et parent quand ouvert depuis un contexte précis */
  defaultType?: CreatableType;
  defaultParentId?: string;
  /**
   * Si fourni, affiche le parent comme figé (pas de picker, pas de recherche).
   * Utilisé quand on crée un enfant depuis la page du parent : le parent est
   * connu à l'avance, pas besoin de le choisir.
   */
  lockedParent?: {
    id: string;
    key: string;
    title: string;
    type: TicketType;
  };
  /** Rôles permis pour restreindre le dropdown */
  allowedTypes: CreatableType[];
}

export function CreateTicketDialog({
  projectId,
  open,
  onOpenChange,
  defaultType,
  defaultParentId,
  lockedParent,
  allowedTypes,
}: Props) {
  const router = useRouter();

  const [type, setType] = useState<CreatableType>(defaultType ?? allowedTypes[0] ?? "EPIC");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string | null>(
    lockedParent?.id ?? defaultParentId ?? null
  );
  const [priority, setPriority] = useState(3);
  const [estimatedDays, setEstimatedDays] = useState("");
  const [isEstimated, setIsEstimated] = useState(true);
  const [isTechnical, setIsTechnical] = useState(false);
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
    // Si le parent est verrouille, on le conserve apres reset
    setParentId(lockedParent?.id ?? defaultParentId ?? null);
    setPriority(3);
    setEstimatedDays("");
    setIsTechnical(false);
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

    const daysNum = parseFloat(estimatedDays || "0");
    const minutes = Number.isFinite(daysNum) && daysNum >= 0 ? daysToMinutes(daysNum) : 0;
    // Cap serveur = 30 jours = 14400 min ; on bloque d'emblée côté client
    const cappedMinutes = Math.min(minutes, 30 * MINUTES_PER_DAY);

    startTransition(async () => {
      const res = await createTicketAction({
        projectId,
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        parentId: parentId ?? null,
        priority,
        // Si TODO : on force l'estimation à 0 pour cohérence.
        // Si Epic : on force aussi 0 (les Epics ne gèrent pas de temps).
        estimatedMinutes: type === "EPIC" ? 0 : isEstimated ? cappedMinutes : 0,
        assigneeId: assigneeId || null,
        isEstimated,
        // Marqueur technique : applique uniquement aux FEATURE/TASK
        isTechnical:
          type === "FEATURE" || type === "TASK" ? isTechnical : false,
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
              disabled={!!lockedParent && allowedTypes.length === 1}
            >
              {allowedTypes.map((t) => (
                <option key={t} value={t}>
                  {TICKET_TYPE_META[t as TicketType].label}
                </option>
              ))}
            </Select>
            {!!lockedParent && allowedTypes.length === 1 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Type imposé par le parent {lockedParent.key} ({TICKET_TYPE_META[lockedParent.type].label}).
              </p>
            )}
          </div>

          {/* Parent (si applicable) */}
          {needsParent && lockedParent && (
            <div>
              <Label>Parent</Label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30">
                {(() => {
                  const ParentIcon = TICKET_TYPE_META[lockedParent.type].icon;
                  return (
                    <ParentIcon
                      className={`w-4 h-4 ${TICKET_TYPE_META[lockedParent.type].iconColor}`}
                      aria-hidden
                    />
                  );
                })()}
                <span className="font-mono text-xs text-muted-foreground">
                  {lockedParent.key}
                </span>
                <span className="text-sm truncate">{lockedParent.title}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Parent verrouillé : ce sous-ticket sera créé sous {lockedParent.key}.
              </p>
            </div>
          )}

          {/* Parent picker classique si pas de lockedParent */}
          {needsParent && !lockedParent && (
            <div>
              <Label>
                Parent *{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  ({type === "FEATURE"
                    ? "Epic"
                    : type === "USER_STORY"
                    ? "Feature"
                    : "Feature, User Story ou Bug"})
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

          {/* Priorité + Estimation (l'estimation ne s'applique pas aux Epics) */}
          <div className={type === "EPIC" ? "" : "grid grid-cols-2 gap-3"}>
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
            {type !== "EPIC" && (
              <div>
                <Label htmlFor="ticket-estimated">
                  Estimé (jours)
                  {!isEstimated && (
                    <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                      (ignoré pour une TODO)
                    </span>
                  )}
                </Label>
                <Input
                  id="ticket-estimated"
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={estimatedDays}
                  onChange={(e) => setEstimatedDays(e.target.value)}
                  placeholder="0"
                  disabled={!isEstimated}
                />
                <p className="text-[10px] text-muted-foreground mt-1">1 jour = 8 heures</p>
              </div>
            )}
          </div>

          {/* Switch Chiffrée / TODO — uniquement pertinent pour Task */}
          {type === "TASK" && (
            <div className="border rounded-md p-3 bg-muted/30">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="mb-1 block">Type de tâche</Label>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {isEstimated
                      ? "Chiffrée : l'estimation s'ajoute au total de la Feature parente."
                      : "TODO : simple rappel, ne compte PAS dans l'atterrissage de la Feature."}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsEstimated(true)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                      isEstimated
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent"
                    }`}
                  >
                    Chiffrée
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEstimated(false)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                      !isEstimated
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent"
                    }`}
                  >
                    TODO
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Marqueur Technique : visible uniquement pour FEATURE et TASK */}
          {(type === "FEATURE" || type === "TASK") && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="ticket-technical"
                checked={isTechnical}
                onChange={(e) => setIsTechnical(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label
                htmlFor="ticket-technical"
                className="text-sm font-normal cursor-pointer"
              >
                Ticket technique
                <span className="text-xs text-muted-foreground ml-2">
                  (refactor, infra, dette technique)
                </span>
              </Label>
            </div>
          )}

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
