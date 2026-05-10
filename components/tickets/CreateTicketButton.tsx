"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CreateTicketDialog } from "./CreateTicketDialog";

type CreatableType = "EPIC" | "FEATURE" | "USER_STORY";

interface Props {
  projectId: string;
  /** Rôle de l'utilisateur courant pour filtrer les types autorisés */
  userRole: Role;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}

// Alignement strict avec TYPE_PERMISSIONS côté Server Action
const ROLE_TO_TYPES: Record<Role, CreatableType[]> = {
  ADMIN: ["EPIC", "FEATURE", "USER_STORY"],
  PRODUCT_OWNER: ["EPIC", "FEATURE", "USER_STORY"],
  DEVELOPER: ["USER_STORY"],
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
