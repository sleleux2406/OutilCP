"use client";

import { useState, useTransition } from "react";
import { Loader2, UserPlus } from "lucide-react";
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
import { createUserAction } from "@/app/actions/users";

interface Props {
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

export function CreateUserDialog({ open, onClose, onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(Role.DEVELOPER);
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error("Le nom doit contenir au moins 2 caractères");
      return;
    }
    if (!email.includes("@") || email.length < 5) {
      toast.error("Email invalide");
      return;
    }
    if (password.length < 8) {
      toast.error("Le mot de passe doit faire au moins 8 caractères");
      return;
    }

    startTransition(async () => {
      const res = await createUserAction({
        email: email.trim().toLowerCase(),
        name: name.trim(),
        role,
        password,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          FORBIDDEN: "Vous n'avez pas les droits",
          DUPLICATE_EMAIL: "Cet email est déjà utilisé",
          RATE_LIMITED: "Trop de créations rapides, réessayez dans quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`Utilisateur ${email} créé`);
      onSuccess();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" aria-hidden />
            Nouvel utilisateur
          </DialogTitle>
          <DialogDescription>
            Créer un nouveau compte. L&apos;utilisateur pourra se connecter immédiatement avec
            l&apos;email et le mot de passe que vous saisissez.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="user-email">Email *</Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="prenom.nom@entreprise.fr"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="user-name">Nom complet *</Label>
            <Input
              id="user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={100}
              placeholder="Prénom Nom"
            />
          </div>

          <div>
            <Label htmlFor="user-role">Rôle *</Label>
            <Select
              id="user-role"
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

          <div>
            <Label htmlFor="user-password">Mot de passe initial *</Label>
            <Input
              id="user-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Au moins 8 caractères"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              L&apos;utilisateur pourra le changer après s&apos;être connecté.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <UserPlus className="h-4 w-4" />
              Créer l&apos;utilisateur
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
