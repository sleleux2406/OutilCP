"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
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
import {
  createTestCaseAction,
  updateTestCaseAction,
} from "@/app/actions/test-cases";

export interface TestCaseInitial {
  id: string;
  title: string;
  preconditions: string | null;
  steps: string;
  expected: string;
}

interface Props {
  ticketId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Si fourni, édition du cas existant. Sinon, création. */
  editing?: TestCaseInitial | null;
}

export function TestCaseDialog({ ticketId, open, onOpenChange, editing }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [preconditions, setPreconditions] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [isPending, startTransition] = useTransition();

  const isEdit = !!editing;

  // Pré-remplir les champs quand on édite
  useEffect(() => {
    if (open && editing) {
      setTitle(editing.title);
      setPreconditions(editing.preconditions ?? "");
      setSteps(editing.steps);
      setExpected(editing.expected);
    } else if (open && !editing) {
      setTitle("");
      setPreconditions("");
      setSteps("");
      setExpected("");
    }
  }, [open, editing]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    if (title.trim().length < 3) {
      toast.error("Le titre doit contenir au moins 3 caractères");
      return;
    }
    if (steps.trim().length === 0) {
      toast.error("Les étapes sont obligatoires");
      return;
    }
    if (expected.trim().length === 0) {
      toast.error("Le résultat attendu est obligatoire");
      return;
    }

    startTransition(async () => {
      if (isEdit && editing) {
        const res = await updateTestCaseAction({
          testCaseId: editing.id,
          title: title.trim(),
          preconditions: preconditions.trim() || undefined,
          steps: steps.trim(),
          expected: expected.trim(),
        });
        if (!res.ok) {
          toast.error(
            res.error === "FORBIDDEN"
              ? "Accès refusé"
              : res.error === "NOT_FOUND"
              ? "Cas introuvable"
              : "Saisie invalide"
          );
          return;
        }
        toast.success("Cas de test mis à jour");
      } else {
        const res = await createTestCaseAction({
          ticketId,
          title: title.trim(),
          preconditions: preconditions.trim() || undefined,
          steps: steps.trim(),
          expected: expected.trim(),
        });
        if (!res.ok) {
          const msg = {
            VALIDATION: "Saisie invalide",
            FORBIDDEN: "Accès refusé",
            NOT_FOUND: "Ticket introuvable",
            NOT_TESTABLE: "Ce ticket n'accepte pas de cas de test (seules Features et User Stories)",
            RATE_LIMITED: "Trop de créations rapides, réessayez dans quelques minutes",
          }[res.error];
          toast.error(msg);
          return;
        }
        toast.success("Cas de test créé");
      }

      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-cyan-500" aria-hidden />
            {isEdit ? "Modifier le cas de test" : "Nouveau cas de test"}
          </DialogTitle>
          <DialogDescription>
            Un testeur parcourra les cas un par un dans le Test Runner.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="tc-title">Titre *</Label>
            <Input
              id="tc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              minLength={3}
              placeholder="Ex : Paiement CB simple avec carte 4242"
            />
          </div>

          <div>
            <Label htmlFor="tc-preconditions">Préconditions</Label>
            <Textarea
              id="tc-preconditions"
              value={preconditions}
              onChange={(e) => setPreconditions(e.target.value)}
              rows={2}
              maxLength={5000}
              placeholder="Ex : Un produit dans le panier, utilisateur connecté"
            />
          </div>

          <div>
            <Label htmlFor="tc-steps">Étapes *</Label>
            <Textarea
              id="tc-steps"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={4}
              maxLength={5000}
              required
              placeholder="1. Aller au panier&#10;2. Cliquer sur Payer&#10;3. Saisir 4242 4242 4242 4242"
            />
          </div>

          <div>
            <Label htmlFor="tc-expected">Résultat attendu *</Label>
            <Textarea
              id="tc-expected"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              rows={3}
              maxLength={5000}
              required
              placeholder="Ex : Confirmation de paiement affichée, email envoyé, commande créée avec statut PAID"
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
              {isEdit ? "Enregistrer" : "Créer le cas"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
