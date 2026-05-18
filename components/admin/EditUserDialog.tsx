"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Role } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { updateUserAction, type UserListItem } from "@/app/actions/users";

interface Props {
  user: UserListItem;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: Role.ADMIN, label: "Administrateur" },
  { value: Role.PRODUCT_OWNER, label: "Product Owner" },
  { value: Role.DEVELOPER, label: "Développeur" },
  { value: Role.TESTER, label: "Testeur" },
];

export function EditUserDialog({ user, open, onClose, onSuccess }: Props) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [isPending, startTransition] = useTransition();

  const hasChanges = name !== user.name || role !== user.role;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) {
      onClose();
      return;
    }
    if (name.trim().length < 2) {
      toast.error("Le nom doit contenir au moins 2 caractères");
      return;
    }

    startTransition(async () => {
      const res = await updateUserAction({
        userId: user.id,
        name: name !== user.name ? name.trim() : undefined,
        role: role !== user.role ? role : undefined,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          FORBIDDEN: "Vous n'avez pas les droits",
          USER_NOT_FOUND: "Utilisateur introuvable",
          CANNOT_DEMOTE_LAST_ADMIN:
            "Impossible : c'est le dernier ADMIN actif. Promouvez d'abord un autre utilisateur.",
          RATE_LIMITED: "Trop de modifications rapides",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`${user.email} mis à jour`);
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" aria-hidden />
            Modifier {user.email}
          </DialogTitle>
          <DialogDescription>
            Modifier le nom ou le rôle de cet utilisateur. L&apos;email n&apos;est pas modifiable.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Email</Label>
            <p className="text-sm font-mono text-muted-foreground border rounded-md px-3 py-2 bg-muted/30">
              {user.email}
            </p>
          </div>

          <div>
            <Label htmlFor="edit-name">Nom complet *</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={100}
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="edit-role">Rôle *</Label>
            <Select
              id="edit-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending || !hasChanges}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
