"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Role, TicketType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CreateTicketDialog } from "./CreateTicketDialog";
import { ALLOWED_CHILDREN } from "@/lib/tickets/hierarchy";

type CreatableType = "EPIC" | "FEATURE" | "USER_STORY" | "TASK";

interface Props {
  projectId: string;
  /** Parent dans lequel le sous-ticket sera créé (verrouillé) */
  parent: {
    id: string;
    key: string;
    title: string;
    type: TicketType;
  };
  /** Rôle de l'utilisateur courant pour filtrer les types autorisés */
  userRole: Role;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}

/**
 * Mêmes restrictions que CreateTicketButton : ce que chaque rôle a le droit
 * de créer via cette action. Aligné sur TYPE_PERMISSIONS dans app/actions/tickets.ts.
 *
 * Note : BUG n'est PAS dans cette liste — les bugs passent par CreateBugButton
 * qui a son propre flux (workflow KO + parent Feature/US uniquement).
 */
const ROLE_TO_TYPES: Record<Role, CreatableType[]> = {
  ADMIN: ["EPIC", "FEATURE", "USER_STORY", "TASK"],
  PRODUCT_OWNER: ["EPIC", "FEATURE", "USER_STORY", "TASK"],
  DEVELOPER: ["USER_STORY", "TASK"],
  TESTER: [],
};

/**
 * Bouton "Créer un sous-ticket" sur la page d'un ticket parent.
 * Calcule dynamiquement les types autorisés en croisant :
 *   - les types autorisés sous ce parent (ALLOWED_CHILDREN[parent.type])
 *   - les types que le rôle peut créer (ROLE_TO_TYPES[userRole])
 *   - en excluant BUG (passé par CreateBugButton dans le header)
 *
 * Le bouton se masque si l'intersection est vide :
 *   - parent de type TASK ou BUG (pas d'enfants autorisés aujourd'hui)
 *   - rôle TESTER
 *   - rôle DEVELOPER avec parent EPIC (DEV ne peut pas créer de FEATURE)
 */
export function CreateChildTicketButton({
  projectId,
  parent,
  userRole,
  label = "Sous-ticket",
  variant = "outline",
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);

  // Types acceptés par le parent (hiérarchie métier)
  const childrenTypesByHierarchy = ALLOWED_CHILDREN[parent.type] as CreatableType[];
  // Types que ce rôle peut créer
  const rolePermittedTypes = ROLE_TO_TYPES[userRole];

  // Intersection, en excluant BUG (passe par CreateBugButton)
  const allowedTypes = childrenTypesByHierarchy.filter(
    (t) => t !== ("BUG" as CreatableType) && rolePermittedTypes.includes(t)
  );

  if (allowedTypes.length === 0) return null;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {label}
      </Button>
      <CreateTicketDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        allowedTypes={allowedTypes}
        defaultType={allowedTypes[0]}
        lockedParent={parent}
      />
    </>
  );
}
