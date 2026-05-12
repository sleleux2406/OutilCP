"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CreateRunDialog } from "./CreateRunDialog";

interface Props {
  parentProjectId: string;
  parentProjectKey: string;
  userRole: Role;
  isSubProject: boolean;
}

/**
 * Bouton "Créer un RUN" visible uniquement pour ADMIN/PO et uniquement sur
 * un projet racine (pas un sous-projet).
 */
export function CreateRunButton({
  parentProjectId,
  parentProjectKey,
  userRole,
  isSubProject,
}: Props) {
  const [open, setOpen] = useState(false);

  if (isSubProject) return null;
  if (userRole !== "ADMIN" && userRole !== "PRODUCT_OWNER") return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
        title="Créer un sous-projet RUN en uploadant une rétro-spécification"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden />
        Créer un RUN
      </Button>
      <CreateRunDialog
        parentProjectId={parentProjectId}
        parentProjectKey={parentProjectKey}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
