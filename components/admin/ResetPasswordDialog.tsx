"use client";

import { useState, useTransition } from "react";
import { Loader2, KeyRound, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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
import { resetUserPasswordAction, type UserListItem } from "@/app/actions/users";

interface Props {
  user: UserListItem;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResetPasswordDialog({ user, open, onClose, onSuccess }: Props) {
  const [newPassword, setNewPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Le mot de passe doit faire au moins 8 caractères");
      return;
    }

    startTransition(async () => {
      const res = await resetUserPasswordAction({
        userId: user.id,
        newPassword,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          FORBIDDEN: "Vous n'avez pas les droits",
          USER_NOT_FOUND: "Utilisateur introuvable",
          RATE_LIMITED: "Trop de modifications rapides",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`Mot de passe de ${user.email} réinitialisé`);
      setNewPassword("");
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" aria-hidden />
            Réinitialiser le mot de passe
          </DialogTitle>
          <DialogDescription>
            Définir un nouveau mot de passe pour <strong>{user.email}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50 p-3 text-xs text-amber-800 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium">Important :</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Toutes les sessions actives de cet utilisateur seront fermées.</li>
                  <li>
                    Communiquez le nouveau mot de passe à l&apos;utilisateur de manière
                    sécurisée.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="reset-password">Nouveau mot de passe *</Label>
            <Input
              id="reset-password"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Au moins 8 caractères"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <KeyRound className="h-4 w-4" />
              Réinitialiser
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
