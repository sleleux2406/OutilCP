"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  MoreVertical,
  Pencil,
  KeyRound,
  UserMinus,
  UserPlus,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  softDeleteUserAction,
  reactivateUserAction,
  type UserListItem,
} from "@/app/actions/users";
import { CreateUserDialog } from "./CreateUserDialog";
import { EditUserDialog } from "./EditUserDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

interface Props {
  users: UserListItem[];
}

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
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

export function UsersAdminList({ users }: Props) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [resetting, setResetting] = useState<UserListItem | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const activeUsers = users.filter((u) => !u.deletedAt);
  const deletedUsers = users.filter((u) => u.deletedAt);

  const handleDeactivate = async (user: UserListItem) => {
    setOpenMenuId(null);
    if (
      !confirm(
        `Désactiver ${user.name} (${user.email}) ?\n\nCet utilisateur ne pourra plus se connecter, mais son historique sera préservé. Vous pouvez le réactiver plus tard.`
      )
    ) {
      return;
    }
    const res = await softDeleteUserAction({ userId: user.id });
    if (!res.ok) {
      const msg = {
        VALIDATION: "Données invalides",
        FORBIDDEN: "Action non autorisée",
        USER_NOT_FOUND: "Utilisateur introuvable",
        CANNOT_DELETE_SELF: "Vous ne pouvez pas vous désactiver vous-même",
        CANNOT_DELETE_LAST_ADMIN: "Impossible : c'est le dernier ADMIN actif",
        ALREADY_DELETED: "Utilisateur déjà désactivé",
        RATE_LIMITED: "Trop de modifications rapides",
      }[res.error];
      toast.error(msg);
      return;
    }
    toast.success(`${user.name} désactivé`);
    router.refresh();
  };

  const handleReactivate = async (user: UserListItem) => {
    setOpenMenuId(null);
    const res = await reactivateUserAction({ userId: user.id });
    if (!res.ok) {
      const msg = {
        VALIDATION: "Données invalides",
        FORBIDDEN: "Action non autorisée",
        USER_NOT_FOUND: "Utilisateur introuvable",
        NOT_DELETED: "Utilisateur non désactivé",
        RATE_LIMITED: "Trop de modifications rapides",
      }[res.error];
      toast.error(msg);
      return;
    }
    toast.success(`${user.name} réactivé`);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Bouton de creation */}
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <UserPlus className="h-4 w-4" aria-hidden />
          Nouvel utilisateur
        </Button>
      </div>

      {/* Liste des utilisateurs actifs */}
      <section>
        <h2 className="text-base font-semibold mb-2">
          Utilisateurs actifs ({activeUsers.length})
        </h2>
        {activeUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed rounded-md p-6 text-center">
            Aucun utilisateur actif.
          </p>
        ) : (
          <UserTable
            users={activeUsers}
            openMenuId={openMenuId}
            setOpenMenuId={setOpenMenuId}
            onEdit={setEditing}
            onResetPassword={setResetting}
            onDeactivate={handleDeactivate}
            onReactivate={handleReactivate}
          />
        )}
      </section>

      {/* Liste des utilisateurs desactives */}
      {deletedUsers.length > 0 && (
        <section>
          <h2 className="text-base font-semibold mb-2 text-muted-foreground">
            Utilisateurs désactivés ({deletedUsers.length})
          </h2>
          <UserTable
            users={deletedUsers}
            openMenuId={openMenuId}
            setOpenMenuId={setOpenMenuId}
            onEdit={setEditing}
            onResetPassword={setResetting}
            onDeactivate={handleDeactivate}
            onReactivate={handleReactivate}
          />
        </section>
      )}

      {/* Dialogs */}
      {createOpen && (
        <CreateUserDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      )}
      {editing && (
        <EditUserDialog
          user={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {resetting && (
        <ResetPasswordDialog
          user={resetting}
          open={!!resetting}
          onClose={() => setResetting(null)}
          onSuccess={() => {
            setResetting(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

interface TableProps {
  users: UserListItem[];
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onEdit: (user: UserListItem) => void;
  onResetPassword: (user: UserListItem) => void;
  onDeactivate: (user: UserListItem) => void;
  onReactivate: (user: UserListItem) => void;
}

function UserTable({
  users,
  openMenuId,
  setOpenMenuId,
  onEdit,
  onResetPassword,
  onDeactivate,
  onReactivate,
}: TableProps) {
  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Utilisateur</th>
            <th className="text-left px-3 py-2 font-medium">Email</th>
            <th className="text-left px-3 py-2 font-medium">Rôle</th>
            <th className="text-left px-3 py-2 font-medium">Tickets</th>
            <th className="text-left px-3 py-2 font-medium">Créé le</th>
            <th className="text-right px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {users.map((u) => {
            const isDeleted = !!u.deletedAt;
            return (
              <tr key={u.id} className={isDeleted ? "opacity-60" : ""}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/15 text-primary text-xs font-semibold grid place-items-center shrink-0">
                      {u.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <span className="font-medium">{u.name}</span>
                    {isDeleted && (
                      <span
                        className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                        title={`Désactivé le ${formatDate(u.deletedAt!)}`}
                      >
                        Désactivé
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                  {u.email}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE[u.role]}`}
                  >
                    {ROLE_LABEL[u.role]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {u.ticketsCreatedCount} créés · {u.ticketsAssignedCount} assignés
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {formatDate(u.createdAt)}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="relative inline-block">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        setOpenMenuId(openMenuId === u.id ? null : u.id)
                      }
                      aria-label="Actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                    {openMenuId === u.id && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-popover border rounded-md shadow-md z-10 py-1">
                        {!isDeleted && (
                          <>
                            <MenuButton
                              icon={<Pencil className="h-3.5 w-3.5" />}
                              label="Modifier"
                              onClick={() => {
                                setOpenMenuId(null);
                                onEdit(u);
                              }}
                            />
                            <MenuButton
                              icon={<KeyRound className="h-3.5 w-3.5" />}
                              label="Réinitialiser mot de passe"
                              onClick={() => {
                                setOpenMenuId(null);
                                onResetPassword(u);
                              }}
                            />
                            <div className="my-1 border-t" />
                            <MenuButton
                              icon={<UserMinus className="h-3.5 w-3.5 text-red-600" />}
                              label="Désactiver"
                              onClick={() => onDeactivate(u)}
                              danger
                            />
                          </>
                        )}
                        {isDeleted && (
                          <MenuButton
                            icon={<UserPlus className="h-3.5 w-3.5 text-emerald-600" />}
                            label="Réactiver"
                            onClick={() => onReactivate(u)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-left ${danger ? "text-red-600" : ""}`}
    >
      {icon}
      {label}
    </button>
  );
}
