"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "./CreateProjectDialog";

interface Props {
  /** Role de l'utilisateur courant : seul ADMIN peut creer un projet racine */
  userRole: Role;
}

export function CreateProjectButton({ userRole }: Props) {
  const [open, setOpen] = useState(false);

  // Restreint aux ADMIN seulement
  if (userRole !== "ADMIN") return null;

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" aria-hidden />
        Nouveau projet
      </Button>
      <CreateProjectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
