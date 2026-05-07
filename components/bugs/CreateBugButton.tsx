"use client";

import { useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateBugDialog } from "./CreateBugDialog";

interface Props {
  projectId: string;
  defaultParentId?: string;
  /** Texte custom, sinon "Nouveau bug" */
  label?: string;
  /** Variante Tailwind du Button */
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}

/**
 * Bouton "Nouveau bug" qui ouvre le CreateBugDialog.
 * Utilisable dans le header d'une page projet ou d'un ticket.
 */
export function CreateBugButton({
  projectId,
  defaultParentId,
  label = "Nouveau bug",
  variant = "outline",
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className="gap-1.5">
        <Bug className="h-4 w-4" aria-hidden />
        {label}
      </Button>
      <CreateBugDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        defaultParentId={defaultParentId}
      />
    </>
  );
}
