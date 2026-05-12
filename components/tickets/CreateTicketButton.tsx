"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CreateTicketDialog } from "./CreateTicketDialog";

type CreatableType = "EPIC" | "FEATURE" | "USER_STORY" | "TASK";

interface Props {
  projectId: string;
  /** Rôle de l'utilisateur courant pour filtrer les types autorisés */
  userRole: Role;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}

/**
 * Alignement strict avec TYPE_PERMISSIONS côté Server Action (app/actions/tickets.ts).
 *
 * - ADMIN / PRODUCT_OWNER : création complète (Epic, Feature, US, Task)
 * - DEVELOPER : User Story et Task (notamment pour créer des TODO librement)
 * - TESTER : aucun type via ce bouton (ils créent des bugs via le Test Runner)
 */
const ROLE_TO_TYPES: Record<Role, CreatableType[]> = {
  ADMIN: ["EPIC", "FEATURE", "USER_STORY", "TASK"],
  PRODUCT_OWNER: ["EPIC", "FEATURE", "USER_STORY", "TASK"],
  DEVELOPER: ["USER_STORY", "TASK"],
  TESTER: [],
};

export function CreateTicketButton({
  projectId,
  userRole,
  label = "Nouveau ticket",
  variant = "default",
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);
  const allowedTypes = ROLE_TO_TYPES[userRole];

  // Un testeur n'a le droit de créer aucun de ces types → masque le bouton
  if (allowedTypes.length === 0) return null;

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" aria-hidden />
        {label}
      </Button>
      <CreateTicketDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        allowedTypes={allowedTypes}
      />
    </>
  );
}
