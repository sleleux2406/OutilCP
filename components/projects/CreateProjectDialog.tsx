"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createProjectAction } from "@/app/actions/projects";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/**
 * Genere une cle de projet a partir du nom :
 *   "Mon Super Projet" -> "MSP"
 *   "Authentification"  -> "AUTH"
 *   "v2"                -> "V2"
 *
 * Si plusieurs mots, on prend les initiales (max 5).
 * Sinon, les 4 premieres lettres en majuscules.
 */
function suggestKeyFromName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "";

  // Decompose en mots significatifs (>= 2 chars), retire les caracteres speciaux
  const words = trimmed
    .split(/[\s\-_]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((w) => w.length >= 1);

  if (words.length === 0) return "";

  if (words.length >= 2) {
    // Initiales (max 5)
    return words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // Un seul mot : 4 premieres lettres
  return words[0].slice(0, 4).toUpperCase();
}

export function CreateProjectDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [description, setDescription] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Auto-suggestion de la cle tant que l'utilisateur n'a pas tape dans le champ Cle
  const handleNameChange = (newName: string) => {
    setName(newName);
    if (!keyTouched) {
      setKeyValue(suggestKeyFromName(newName));
    }
  };

  const reset = () => {
    setName("");
    setKeyValue("");
    setDescription("");
    setKeyTouched(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 3) {
      toast.error("Le nom doit contenir au moins 3 caractères");
      return;
    }
    if (keyValue.trim().length < 2) {
      toast.error("La clé doit contenir au moins 2 caractères");
      return;
    }
    if (!/^[A-Z][A-Z0-9]*$/.test(keyValue)) {
      toast.error("La clé doit commencer par une lettre majuscule et ne contenir que des lettres et chiffres");
      return;
    }

    startTransition(async () => {
      const res = await createProjectAction({
        name: name.trim(),
        key: keyValue.trim(),
        description: description.trim() || undefined,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Saisie invalide",
          FORBIDDEN: "Seul un ADMIN peut créer un projet",
          DUPLICATE_KEY: `La clé "${keyValue}" est déjà utilisée par un autre projet`,
          RATE_LIMITED: "Trop de créations rapides, réessayez dans quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }
      toast.success(`Projet ${res.projectKey} créé`);
      reset();
      onOpenChange(false);
      // Redirection vers le board du nouveau projet
      router.push(`/projects/${res.projectKey}/board`);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isPending) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" aria-hidden />
            Nouveau projet
          </DialogTitle>
          <DialogDescription>
            Créer un nouveau projet racine. Vous pourrez ensuite y ajouter des Epics et des Features.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {/* Nom */}
          <div>
            <Label htmlFor="project-name">Nom *</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              maxLength={100}
              minLength={3}
              required
              placeholder="Ex : Authentification, Mobile App, Refonte Dashboard…"
              autoFocus
            />
          </div>

          {/* Cle */}
          <div>
            <Label htmlFor="project-key">
              Clé *{" "}
              <span className="text-xs text-muted-foreground font-normal">
                (préfixe des tickets, ex : AUTH-1, AUTH-2…)
              </span>
            </Label>
            <Input
              id="project-key"
              value={keyValue}
              onChange={(e) => {
                setKeyValue(e.target.value.toUpperCase());
                setKeyTouched(true);
              }}
              maxLength={10}
              minLength={2}
              required
              placeholder="AUTH"
              className="font-mono uppercase"
              pattern="[A-Z][A-Z0-9]*"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              2 à 10 caractères, lettres majuscules et chiffres uniquement. Ne pourra pas être modifiée après création.
            </p>
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Objectif du projet, contexte, périmètre…"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Plus className="h-4 w-4" />
              Créer le projet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
