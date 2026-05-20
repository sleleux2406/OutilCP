"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserMinus, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  addProjectMemberAction,
  removeProjectMemberAction,
  type ProjectMemberItem,
} from "@/app/actions/project-members";

interface AvailableUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface Props {
  project: { id: string; key: string; name: string };
  members: ProjectMemberItem[];
  availableUsers: AvailableUser[];
  currentUserId: string;
}

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrateur",
  PRODUCT_OWNER: "Product Owner",
  DEVELOPER: "Développeur",
  TESTER: "Testeur",
};

const ROLE_BADGE: Record<Role, string> = {
  ADMIN: "bg-red-500/15 text-red-700 dark:text-red-400",
  PRODUCT_OWNER: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  DEVELOPER: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  TESTER: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

export function ProjectMembersList({
  project,
  members,
  availableUsers,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState<string>(
    availableUsers[0]?.id ?? ""
  );
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    if (!selectedUserId) {
      toast.error("Sélectionnez un utilisateur à ajouter");
      return;
    }

    startTransition(async () => {
      const res = await addProjectMemberAction({
        projectId: project.id,
        userId: selectedUserId,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Données invalides",
          FORBIDDEN: "Vous n'avez pas les droits sur ce projet",
          PROJECT_NOT_FOUND: "Projet introuvable",
          USER_NOT_FOUND: "Utilisateur introuvable ou désactivé",
          ALREADY_MEMBER: "Cet utilisateur est déjà membre",
          RATE_LIMITED: "Trop d'opérations rapides, patientez quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }
      const user = availableUsers.find((u) => u.id === selectedUserId);
      toast.success(`${user?.name ?? "Membre"} ajouté au projet`);
      router.refresh();
    });
  };

  const handleRemove = (member: ProjectMemberItem) => {
    if (
      !confirm(
        `Retirer ${member.name} du projet ${project.key} ?\n\nLe compte de l'utilisateur n'est pas supprimé, il perdra simplement l'accès à ce projet.`
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await removeProjectMemberAction({
        projectId: project.id,
        userId: member.userId,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Données invalides",
          FORBIDDEN: "Vous ne pouvez pas vous retirer vous-même",
          PROJECT_NOT_FOUND: "Projet introuvable",
          NOT_MEMBER: "Cet utilisateur n'est plus membre",
          RATE_LIMITED: "Trop d'opérations rapides",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`${member.name} retiré du projet`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* Bandeau d'aide */}
      <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/50 p-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-blue-700 dark:text-blue-300 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-blue-900 dark:text-blue-100">
              Multi-projet : qui voit quoi ?
            </p>
            <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-0.5 list-disc list-inside">
              <li>
                Les <strong>Administrateurs</strong> voient tous les projets,
                pas besoin de les ajouter ici.
              </li>
              <li>
                Les <strong>Product Owners</strong>, <strong>Développeurs</strong> et{" "}
                <strong>Testeurs</strong> ne voient ce projet QUE s&apos;ils sont
                membres.
              </li>
              <li>
                Les congés saisis par un membre bloquent automatiquement sa
                disponibilité sur tous ses projets.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Section Ajouter un membre */}
      <section className="border rounded-lg p-4 bg-card space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-emerald-600" />
          Ajouter un membre
        </h2>

        {availableUsers.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Tous les utilisateurs actifs sont déjà membres de ce projet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <Label htmlFor="select-user">Utilisateur</Label>
              <Select
                id="select-user"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email}) — {ROLE_LABEL[u.role]}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              onClick={handleAdd}
              disabled={isPending || !selectedUserId}
              className="gap-1.5"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Ajouter
            </Button>
          </div>
        )}
      </section>

      {/* Section Membres actuels */}
      <section>
        <h2 className="text-sm font-semibold mb-2">
          Membres actuels ({members.length})
        </h2>

        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed rounded-md p-6 text-center">
            Aucun membre pour ce projet. Ajoutez-en un ci-dessus.
          </p>
        ) : (
          <ul className="border rounded-lg divide-y bg-card">
            {members.map((m) => {
              const isSelf = m.userId === currentUserId;
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/15 text-primary text-xs font-semibold grid place-items-center shrink-0">
                    {m.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      {isSelf && (
                        <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                          (vous)
                        </span>
                      )}
                      <span
                        className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_BADGE[m.role]}`}
                      >
                        {ROLE_LABEL[m.role]}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {m.email}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Ajouté le {formatDate(m.addedAt)}
                      {m.addedByName && ` par ${m.addedByName}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(m)}
                    disabled={isPending || isSelf}
                    title={
                      isSelf
                        ? "Vous ne pouvez pas vous retirer vous-même"
                        : "Retirer du projet"
                    }
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 gap-1"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    Retirer
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
