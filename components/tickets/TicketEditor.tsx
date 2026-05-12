"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Edit, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  updateTicketAction,
  listAssignableUsersAction,
} from "@/app/actions/tickets";
import { PRIORITY_META } from "@/lib/tickets/metadata";
import {
  daysToMinutes,
  minutesToDays,
  MINUTES_PER_DAY,
  toISODate,
} from "@/lib/utils";
import {
  computeEstimationEditability,
  getLockReasonLabel,
} from "@/lib/tickets/estimation-rules";

export interface TicketEditorInitial {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  estimatedMinutes: number;
  remainingMinutes: number | null;
  loggedMinutes: number;
  status: import("@prisma/client").TicketStatus;
  type: import("@prisma/client").TicketType;
  /**
   * True si le ticket a des enfants qui comptent dans l'agrégation.
   * Pour une Feature : au moins un enfant Task ou Bug.
   * Pour les autres : au moins un enfant.
   */
  hasAggregatingChildren: boolean;
  assigneeId: string | null;
  startDate: Date | null;
}

interface Props {
  ticket: TicketEditorInitial;
  /** Si false, ne pas afficher le bouton Modifier */
  canEdit: boolean;
}

/**
 * Bouton "Modifier" + dialogue pour éditer titre, description, priorité,
 * estimation (jours) et assignee d'un ticket.
 *
 * Le statut est géré séparément par TicketStatusPicker.
 * Le type et le parent sont intentionnellement immuables (structurel).
 */
export function TicketEditor({ ticket, canEdit }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description ?? "");
  const [priority, setPriority] = useState(ticket.priority);
  const [estimatedDays, setEstimatedDays] = useState(
    ticket.estimatedMinutes > 0 ? String(minutesToDays(ticket.estimatedMinutes)) : ""
  );
  // Reste à faire : string vide = "non défini" (on enverra null), sinon valeur en jours
  const [remainingDays, setRemainingDays] = useState(
    ticket.remainingMinutes !== null
      ? String(minutesToDays(ticket.remainingMinutes))
      : ""
  );
  const [assigneeId, setAssigneeId] = useState<string>(ticket.assigneeId ?? "");
  const [startDate, setStartDate] = useState<string>(toISODate(ticket.startDate));
  const [assignableUsers, setAssignableUsers] = useState<
    { id: string; name: string; role: string }[]
  >([]);

  // Charge les users assignables à l'ouverture du dialogue
  useEffect(() => {
    if (!open) return;
    listAssignableUsersAction()
      .then((res) => setAssignableUsers(res.users))
      .catch(() => setAssignableUsers([]));
  }, [open]);

  // Reset des valeurs si le ticket change (navigation entre tickets sans démonter)
  useEffect(() => {
    if (!open) {
      setTitle(ticket.title);
      setDescription(ticket.description ?? "");
      setPriority(ticket.priority);
      setEstimatedDays(
        ticket.estimatedMinutes > 0 ? String(minutesToDays(ticket.estimatedMinutes)) : ""
      );
      setRemainingDays(
        ticket.remainingMinutes !== null
          ? String(minutesToDays(ticket.remainingMinutes))
          : ""
      );
      setAssigneeId(ticket.assigneeId ?? "");
      setStartDate(toISODate(ticket.startDate));
    }
  }, [ticket, open]);

  if (!canEdit) return null;

  // Règles métier : décide ce qui est modifiable
  const editability = computeEstimationEditability({
    type: ticket.type,
    status: ticket.status,
    loggedMinutes: ticket.loggedMinutes,
    hasAggregatingChildren: ticket.hasAggregatingChildren,
  });
  const lockLabel = getLockReasonLabel(editability.lockReason);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const t = title.trim();
    if (t.length < 3 || t.length > 200) {
      toast.error("Le titre doit contenir entre 3 et 200 caractères");
      return;
    }

    const dNum = parseFloat(estimatedDays || "0");
    const minutes =
      Number.isFinite(dNum) && dNum >= 0
        ? Math.min(daysToMinutes(dNum), 30 * MINUTES_PER_DAY)
        : 0;

    // Reste : champ vide → null (fallback à estimated-logged), sinon conversion
    const rNum = parseFloat(remainingDays);
    const remainingValue =
      remainingDays.trim() === ""
        ? null
        : Number.isFinite(rNum) && rNum >= 0
        ? Math.min(daysToMinutes(rNum), 30 * MINUTES_PER_DAY)
        : 0;

    const descTrimmed = description.trim();

    // Normalise startDate : string non vide = valeur, string vide = null (retirer)
    const startDateValue: string | null | undefined = (() => {
      const current = toISODate(ticket.startDate);
      if (startDate === current) return undefined; // inchangé
      if (startDate.trim() === "") return null; // retirer la planification
      return startDate;
    })();

    startTransition(async () => {
      const res = await updateTicketAction({
        ticketId: ticket.id,
        title: t,
        description: descTrimmed.length > 0 ? descTrimmed : null,
        priority,
        estimatedMinutes: minutes,
        remainingMinutes: remainingValue,
        assigneeId: assigneeId || null,
        ...(startDateValue !== undefined ? { startDate: startDateValue } : {}),
      });

      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          FORBIDDEN: "Vous n'êtes pas autorisé à modifier ce ticket",
          NOT_FOUND: "Ticket introuvable",
          ASSIGNEE_NOT_FOUND: "L'utilisateur assigné n'existe plus",
          ESTIMATED_LOCKED:
            "Estimation initiale verrouillée (ticket terminé, temps déjà loggé, ou ticket parent).",
          REMAINING_LOCKED:
            "Reste à faire verrouillé (ticket terminé, à froid, ou ticket parent).",
          RATE_LIMITED: "Trop de modifications rapides, réessayez dans quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }

      toast.success("Ticket mis à jour");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Edit className="h-3.5 w-3.5" aria-hidden />
        Modifier
      </Button>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5" aria-hidden />
              Modifier le ticket
            </DialogTitle>
            <DialogDescription>
              Le statut se change directement sur la page. Le type et le parent ne sont
              pas modifiables (structurels).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            {lockLabel && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {lockLabel}
              </div>
            )}

            <div>
              <Label htmlFor="edit-title">Titre *</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                minLength={3}
              />
            </div>

            <div>
              <Label htmlFor="edit-description">Description (markdown)</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={8}
                maxLength={10_000}
                placeholder="Contexte, critères d'acceptation, notes..."
              />
              <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                {description.length} / 10000
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit-priority">Priorité</Label>
                <Select
                  id="edit-priority"
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
                <Label htmlFor="edit-estimated">
                  Estimé initial (jours)
                  {!editability.canEditEstimated && (
                    <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                      (verrouillé)
                    </span>
                  )}
                </Label>
                <Input
                  id="edit-estimated"
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={estimatedDays}
                  onChange={(e) => setEstimatedDays(e.target.value)}
                  placeholder="0"
                  disabled={!editability.canEditEstimated}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  1 jour = 8 heures
                  {editability.lockReason === "COLD_AUTO_SYNC" &&
                    " · Le reste à faire se synchronisera automatiquement."}
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="edit-remaining">
                Reste à faire (jours)
                {!editability.canEditRemaining && (
                  <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                    (verrouillé)
                  </span>
                )}
              </Label>
              <Input
                id="edit-remaining"
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={remainingDays}
                onChange={(e) => setRemainingDays(e.target.value)}
                placeholder={
                  editability.canEditRemaining ? "Ré-estimez le temps restant" : ""
                }
                disabled={!editability.canEditRemaining}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {editability.lockReason === "HOT_ESTIMATED_FROZEN"
                  ? "Du temps a été loggé : ajustez ce champ au fil du ticket."
                  : editability.lockReason === "COLD_AUTO_SYNC"
                  ? "Calculé automatiquement à partir de l'estimation initiale."
                  : editability.lockReason === "DONE"
                  ? "Ticket terminé : plus rien à faire."
                  : editability.lockReason === "HAS_CHILDREN"
                  ? "Valeur agrégée depuis les enfants."
                  : "Ré-estimez le temps restant au fur et à mesure."}
              </p>
            </div>

            <div>
              <Label htmlFor="edit-start-date">
                Date de début
                {ticket.hasAggregatingChildren && (
                  <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                    (calculée depuis les enfants)
                  </span>
                )}
              </Label>
              <Input
                id="edit-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={ticket.hasAggregatingChildren}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {ticket.hasAggregatingChildren
                  ? "La date de début et la date de fin sont agrégées depuis les enfants chiffrés."
                  : "Jour ouvré uniquement (week-end normalisé au lundi suivant). La date de fin est calculée automatiquement."}
              </p>
            </div>

            <div>
              <Label htmlFor="edit-assignee">Assigné à</Label>
              <Select
                id="edit-assignee"
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
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
