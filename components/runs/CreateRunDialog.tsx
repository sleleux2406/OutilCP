"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckSquare,
  ChevronRight,
  FileText,
  Loader2,
  Mountain,
  Sparkles,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  previewSpecAction,
  createRunFromSpecAction,
} from "@/app/actions/specs";
import type { ParseResult } from "@/lib/specs/parse-retrospec";

interface Props {
  parentProjectId: string;
  parentProjectKey: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/**
 * Dialogue en 2 étapes :
 *   1. Paste du texte de rétro-spec + clic "Analyser"
 *   2. Aperçu de la hiérarchie détectée avec cases à cocher + clic "Créer le RUN"
 *
 * Après création : redirection vers le board du nouveau RUN.
 */
export function CreateRunDialog({
  parentProjectId,
  parentProjectKey,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<"paste" | "preview">("paste");
  const [text, setText] = useState("");
  const [runName, setRunName] = useState("");
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [selectedEpics, setSelectedEpics] = useState<Set<string>>(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const [detectedFormat, setDetectedFormat] = useState<"markdown" | "text" | null>(null);
  const [specVersion, setSpecVersion] = useState("v1");
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setStep("paste");
    setText("");
    setRunName("");
    setPreview(null);
    setSelectedEpics(new Set());
    setSelectedFeatures(new Set());
    setDetectedFormat(null);
    setSpecVersion("v1");
  };

  const close = () => {
    if (isPending) return;
    onOpenChange(false);
    // Reset après fermeture pour repartir propre la prochaine fois
    setTimeout(reset, 200);
  };

  // ─── Étape 1 : Analyser le texte collé ───
  const doPreview = () => {
    if (text.trim().length < 10) {
      toast.error("Collez un texte de spécifications plus long.");
      return;
    }
    startTransition(async () => {
      const res = await previewSpecAction({ text: text.trim() });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Texte invalide (trop court ou trop long)",
          FORBIDDEN: "Vous n'êtes pas autorisé à créer un RUN",
          RATE_LIMITED: "Trop d'analyses rapides, réessayez dans quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }
      if (res.parsed.counts.epics === 0) {
        toast.error(
          "Aucun Epic détecté. Vérifiez le format : 'EPIC E01 : Titre'."
        );
        setPreview(res.parsed); // on affiche quand même pour montrer les warnings
      }
      setPreview(res.parsed);
      // Par défaut, tout coché
      const allEpics = new Set(res.parsed.epics.map((e) => e.code));
      const allFeatures = new Set(
        res.parsed.epics.flatMap((e) => e.features.map((f) => f.code))
      );
      setSelectedEpics(allEpics);
      setSelectedFeatures(allFeatures);
      setRunName(`RUN ${new Date().toLocaleDateString("fr-FR")}`);
      // Memoise le format detecte pour l'afficher dans la preview
      setDetectedFormat(res.detectedFormat);
      // Si une version a ete extraite du frontmatter Markdown, on la pre-remplit
      if (res.detectedVersion) {
        setSpecVersion(res.detectedVersion);
      }
      setStep("preview");
    });
  };

  // ─── Étape 2 : Créer le RUN ───
  const doCreate = () => {
    if (!preview) return;
    if (runName.trim().length < 3) {
      toast.error("Saisissez un nom de RUN (min 3 caractères)");
      return;
    }
    const trimmedVersion = specVersion.trim() || "v1";
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmedVersion)) {
      toast.error(
        "Version des specs invalide (lettres, chiffres, points, tirets et underscores uniquement)"
      );
      return;
    }
    if (trimmedVersion.length > 50) {
      toast.error("Version des specs trop longue (max 50 caractères)");
      return;
    }

    // Filtrer uniquement les éléments cochés
    const filteredEpics = preview.epics
      .filter((e) => selectedEpics.has(e.code))
      .map((e) => ({
        code: e.code,
        title: e.title,
        features: e.features
          .filter((f) => selectedFeatures.has(f.code))
          .map((f) => ({
            code: f.code,
            title: f.title,
            description: f.description,
            rules: f.rules,
            scenarios: f.scenarios,
          })),
      }))
      .filter((e) => e.features.length > 0); // Epic sans Feature cochée = ignoré

    if (filteredEpics.length === 0) {
      toast.error("Sélectionnez au moins un Epic avec une Feature.");
      return;
    }

    startTransition(async () => {
      const res = await createRunFromSpecAction({
        parentProjectId,
        runName: runName.trim(),
        specVersion: specVersion.trim() || "v1",
        epics: filteredEpics,
      });
      if (!res.ok) {
        const msg = {
          VALIDATION: "Données invalides lors de la création",
          FORBIDDEN: "Vous n'êtes pas autorisé à créer un RUN",
          PARENT_NOT_FOUND: "Projet parent introuvable ou invalide",
          EMPTY_SPEC: "Aucun Epic à créer",
          RATE_LIMITED: "Trop de créations de RUN, patientez quelques minutes",
        }[res.error];
        toast.error(msg);
        return;
      }

      toast.success(
        `${res.counts.epics} Epic · ${res.counts.features} Features · ${res.counts.testCases} TestCases créés`
      );
      onOpenChange(false);
      setTimeout(reset, 200);
      router.push(`/projects/${res.projectKey}/board`);
    });
  };

  const toggleEpic = (code: string) => {
    setSelectedEpics((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleFeature = (code: string) => {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // ─── Compteurs dynamiques (basés sur la sélection) ───
  const selectedCounts = (() => {
    if (!preview) return { epics: 0, features: 0, testCases: 0 };
    let epics = 0;
    let features = 0;
    let testCases = 0;
    for (const e of preview.epics) {
      const hasAnyFeature = e.features.some((f) => selectedFeatures.has(f.code));
      if (selectedEpics.has(e.code) && hasAnyFeature) epics += 1;
      for (const f of e.features) {
        if (selectedFeatures.has(f.code) && selectedEpics.has(e.code)) {
          features += 1;
          testCases += f.scenarios.length;
        }
      }
    }
    return { epics, features, testCases };
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" aria-hidden />
            Créer un RUN depuis une rétro-spec
          </DialogTitle>
          <DialogDescription>
            {step === "paste"
              ? "Collez le texte de votre spécification fonctionnelle. Format attendu : 'EPIC E01 : ...' puis 'FEATURE F01.1 : ...'."
              : `Aperçu de la hiérarchie détectée. Cochez/décochez ce que vous voulez créer dans le sous-projet ${parentProjectKey}-RUN-N.`}
          </DialogDescription>
        </DialogHeader>

        {step === "paste" && (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              maxLength={200_000}
              placeholder={`Format Markdown : # = EPIC, ## = FEATURE. Les codes (E01, F01.1...) sont attribues automatiquement.

---
version: retrospec-1
---

# Authentification

## Login email/password

### Description
Permettre aux utilisateurs de se connecter.

### Règles métier
- Mot de passe min 8 caractères
- Lock après 5 tentatives

### Scénarios de test
- Connexion réussie (Résultat : redirection vers /)
- Mot de passe invalide (Résultat : message d'erreur)

## Logout

### Scénarios de test
- Click logout (Résultat : redirige vers /login)

# Profil utilisateur

## Modifier son nom


→ Codes attribues automatiquement dans l'ordre :
   E01 = "Authentification"
     F01.1 = "Login email/password"
     F01.2 = "Logout"
   E02 = "Profil utilisateur"
     F02.1 = "Modifier son nom"

→ Le titre est pris tel quel : aucune extraction de code dans le titre.

→ Format texte legacy aussi supporte : EPIC E01 : ... – FEATURE F01.1 : ... – Description : ... – Règles : ... ; ... – Scénarios : ... (Résultat : ...) ; ...`}
              className="font-mono text-xs flex-1 resize-none"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>{text.length} / 200 000 caractères</span>
              <span className="italic">
                # = Epic, ## = Feature. Codes auto-generes (E01, F01.1...).
              </span>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
            {/* Badge format detecte (information visuelle) */}
            {detectedFormat && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Format detecte :</span>
                <span
                  className={
                    detectedFormat === "markdown"
                      ? "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 font-semibold"
                      : "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-500/15 text-slate-700 dark:text-slate-300 font-semibold"
                  }
                >
                  {detectedFormat === "markdown" ? "Markdown" : "Texte (legacy)"}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="run-name">Nom du RUN *</Label>
                <Input
                  id="run-name"
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  maxLength={200}
                  placeholder="Ex : Sprint 1 — Novembre 2025"
                />
              </div>
              <div>
                <Label htmlFor="spec-version">Version des specs *</Label>
                <Input
                  id="spec-version"
                  value={specVersion}
                  onChange={(e) => setSpecVersion(e.target.value)}
                  maxLength={50}
                  pattern="[a-zA-Z0-9._-]+"
                  placeholder="ex: retrospec-1"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Stockee comme versionCreation et versionSpecsCourante (lettres,
                  chiffres, ._-)
                </p>
              </div>
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <div className="inline-flex items-center gap-1 font-semibold mb-1">
                  <AlertCircle className="h-3 w-3" />
                  {preview.warnings.length} avertissement
                  {preview.warnings.length > 1 ? "s" : ""}
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border rounded-md p-3 bg-muted/30 text-xs space-y-1">
              <p>
                <strong>Sélection actuelle :</strong>{" "}
                <span className="tabular-nums">{selectedCounts.epics}</span> Epic ·{" "}
                <span className="tabular-nums">{selectedCounts.features}</span>{" "}
                Features ·{" "}
                <span className="tabular-nums">{selectedCounts.testCases}</span>{" "}
                TestCases
              </p>
            </div>

            {preview.epics.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Aucun Epic détecté dans le texte fourni.
              </p>
            ) : (
              <ul className="space-y-2">
                {preview.epics.map((epic) => {
                  const epicChecked = selectedEpics.has(epic.code);
                  return (
                    <li key={epic.code} className="border rounded-md">
                      <label className="flex items-start gap-2 p-3 cursor-pointer hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={epicChecked}
                          onChange={() => toggleEpic(epic.code)}
                          className="mt-1"
                        />
                        <Mountain className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                              {epic.code}
                            </span>
                            <span className="font-semibold text-sm truncate">
                              {epic.title}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {epic.features.length} Feature
                            {epic.features.length > 1 ? "s" : ""}
                          </p>
                        </div>
                      </label>

                      {epicChecked && epic.features.length > 0 && (
                        <ul className="border-t bg-muted/20">
                          {epic.features.map((feature) => {
                            const fChecked = selectedFeatures.has(feature.code);
                            return (
                              <li key={feature.code}>
                                <label className="flex items-start gap-2 pl-8 pr-3 py-2 cursor-pointer hover:bg-muted/40">
                                  <input
                                    type="checkbox"
                                    checked={fChecked}
                                    onChange={() => toggleFeature(feature.code)}
                                    className="mt-1"
                                  />
                                  <CheckSquare className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                                        {feature.code}
                                      </span>
                                      <span
                                        className={cn(
                                          "text-sm truncate",
                                          fChecked ? "" : "text-muted-foreground"
                                        )}
                                      >
                                        {feature.title}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                                      {feature.rules.length > 0 && (
                                        <span>
                                          {feature.rules.length} règle
                                          {feature.rules.length > 1 ? "s" : ""}
                                        </span>
                                      )}
                                      {feature.scenarios.length > 0 && (
                                        <span className="inline-flex items-center gap-0.5">
                                          <FileText className="h-2.5 w-2.5" />
                                          {feature.scenarios.length} scénario
                                          {feature.scenarios.length > 1 ? "s" : ""}
                                        </span>
                                      )}
                                      {feature.description && (
                                        <span className="italic truncate max-w-[300px]">
                                          {feature.description}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {preview.orphanFeatures.length > 0 && (
              <div className="border rounded-md p-3 bg-red-500/5 border-red-500/30 text-xs">
                <p className="font-semibold text-red-700 dark:text-red-400 mb-1">
                  {preview.orphanFeatures.length} Feature
                  {preview.orphanFeatures.length > 1 ? "s" : ""} sans Epic parent
                </p>
                <p className="text-muted-foreground">
                  Ces Features ont un code qui ne correspond à aucun Epic détecté.
                  Elles ne seront pas créées. Corrigez votre spec pour les inclure.
                </p>
                <ul className="list-disc pl-4 mt-1">
                  {preview.orphanFeatures.map((f) => (
                    <li key={f.code}>
                      <span className="font-mono">{f.code}</span> — {f.title}{" "}
                      <span className="text-muted-foreground">
                        (attend Epic {f.epicCode})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="border-t pt-4">
          {step === "paste" ? (
            <>
              <Button type="button" variant="ghost" onClick={close} disabled={isPending}>
                Annuler
              </Button>
              <Button
                type="button"
                onClick={doPreview}
                disabled={isPending || text.trim().length < 10}
                className="gap-1.5"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Analyser
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("paste")}
                disabled={isPending}
              >
                Retour
              </Button>
              <Button
                type="button"
                onClick={doCreate}
                disabled={isPending || selectedCounts.epics === 0}
                className="gap-1.5"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Créer le RUN ({selectedCounts.features} Features)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
