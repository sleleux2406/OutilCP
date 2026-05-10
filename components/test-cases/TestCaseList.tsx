"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Edit, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Role } from "@prisma/client";
import {
  deleteTestCaseAction,
  reorderTestCasesAction,
} from "@/app/actions/test-cases";
import { TestCaseDialog, type TestCaseInitial } from "./TestCaseDialog";

export interface TestCaseItem {
  id: string;
  order: number;
  title: string;
  preconditions: string | null;
  steps: string;
  expected: string;
  executionsCount: number;
}

interface Props {
  ticketId: string;
  initialCases: TestCaseItem[];
  userRole: Role;
}

const CAN_MANAGE: Role[] = ["ADMIN", "PRODUCT_OWNER", "TESTER"];

export function TestCaseList({ ticketId, initialCases, userRole }: Props) {
  const router = useRouter();
  const [cases, setCases] = useState<TestCaseItem[]>(
    [...initialCases].sort((a, b) => a.order - b.order)
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TestCaseInitial | null>(null);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const canManage = CAN_MANAGE.includes(userRole);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (c: TestCaseItem) => {
    setEditing({
      id: c.id,
      title: c.title,
      preconditions: c.preconditions,
      steps: c.steps,
      expected: c.expected,
    });
    setDialogOpen(true);
  };

  const handleDelete = (c: TestCaseItem) => {
    if (c.executionsCount > 0) {
      toast.error(
        `Impossible : ce cas a déjà été exécuté ${c.executionsCount} fois. L'historique est préservé.`
      );
      return;
    }
    if (!confirm(`Supprimer le cas "${c.title}" ? Cette action est irréversible.`)) return;

    setPendingOp(`delete-${c.id}`);
    startTransition(async () => {
      const res = await deleteTestCaseAction({ testCaseId: c.id });
      setPendingOp(null);
      if (!res.ok) {
        toast.error(
          res.error === "HAS_EXECUTIONS"
            ? "Ce cas a été exécuté, suppression refusée"
            : res.error === "FORBIDDEN"
            ? "Accès refusé"
            : "Erreur lors de la suppression"
        );
        return;
      }
      // Mise à jour optimiste de la liste
      setCases((prev) => prev.filter((x) => x.id !== c.id));
      toast.success("Cas supprimé");
      router.refresh();
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = cases.findIndex((c) => c.id === active.id);
    const newIndex = cases.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(cases, oldIndex, newIndex);
    setCases(reordered);

    startTransition(async () => {
      const res = await reorderTestCasesAction({
        ticketId,
        orderedIds: reordered.map((c) => c.id),
      });
      if (!res.ok) {
        // Rollback visuel
        setCases([...initialCases].sort((a, b) => a.order - b.order));
        toast.error("Réordonnancement impossible");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">
          Cas de test ({cases.length})
        </h2>
        {canManage && (
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Ajouter un cas
          </Button>
        )}
      </div>

      {cases.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
          Aucun cas de test défini. {canManage && "Cliquez sur Ajouter un cas pour commencer."}
        </p>
      ) : canManage ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={cases.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1">
              {cases.map((c, idx) => (
                <SortableRow
                  key={c.id}
                  testCase={c}
                  index={idx + 1}
                  onEdit={() => openEdit(c)}
                  onDelete={() => handleDelete(c)}
                  pending={pendingOp === `delete-${c.id}`}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        // Lecture seule pour DEVELOPER
        <ul className="space-y-1">
          {cases.map((c, idx) => (
            <li
              key={c.id}
              className="flex items-center gap-3 p-2 rounded hover:bg-muted/50"
            >
              <span className="text-xs text-muted-foreground font-mono tabular-nums w-6 text-center">
                {idx + 1}
              </span>
              <span className="flex-1 text-sm truncate">{c.title}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {c.executionsCount} exéc.
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <TestCaseDialog
          ticketId={ticketId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ligne draggable
// ─────────────────────────────────────────────────────────────

interface RowProps {
  testCase: TestCaseItem;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  pending: boolean;
}

function SortableRow({ testCase, index, onEdit, onDelete, pending }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: testCase.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-2 rounded border bg-card hover:bg-muted/30 transition-colors",
        isDragging && "opacity-50"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
        aria-label="Déplacer"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>

      <span className="text-xs text-muted-foreground font-mono tabular-nums w-6 text-center">
        {index}
      </span>

      <span className="flex-1 text-sm truncate" title={testCase.title}>
        {testCase.title}
      </span>

      {testCase.executionsCount > 0 && (
        <span
          className="text-xs text-muted-foreground tabular-nums"
          title={`${testCase.executionsCount} exécution(s) enregistrée(s)`}
        >
          {testCase.executionsCount} exéc.
        </span>
      )}

      <div className="flex items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onEdit}
          aria-label="Modifier"
        >
          <Edit className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 hover:text-destructive"
          onClick={onDelete}
          disabled={pending}
          aria-label="Supprimer"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </li>
  );
}
