"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Camera, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { recordTestExecutionAction, finishTestRunAction } from "@/app/actions/test-runner";
import { uploadScreenshot } from "@/lib/uploads";
import { BugPreviewDrawer } from "./BugPreviewDrawer";
import { TestRunSummary } from "./TestRunSummary";
import { Bug as BugIcon } from "lucide-react";

export interface TestCaseInRunner {
  id: string;
  order: number;
  title: string;
  preconditions: string | null;
  steps: string;
  expected: string;
}

export interface GeneratedBug {
  id: string;
  key: string;
  title: string;
  parentKey: string;
  url: string;
  forTestCase: string;
}

interface Props {
  testRunId: string;
  ticketKey: string;
  cases: TestCaseInRunner[];
  onFinished: () => void;
}

export function TestRunner({ testRunId, ticketKey, cases, onFinished }: Props) {
  const [index, setIndex] = useState(0);
  const [comment, setComment] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [koMode, setKoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [generatedBugs, setGeneratedBugs] = useState<GeneratedBug[]>([]);
  const [previewBug, setPreviewBug] = useState<GeneratedBug | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const current = cases[index];
  const progress = (index / cases.length) * 100;

  const submit = useCallback(
    (result: "OK" | "KO") => {
      setError(null);
      if (result === "KO" && comment.trim().length === 0) {
        setError("Un commentaire est obligatoire pour un KO.");
        return;
      }

      startTransition(async () => {
        let screenshotUrl: string | undefined;
        if (result === "KO" && screenshot) {
          try {
            const url = await uploadScreenshot(screenshot);
            if (url) screenshotUrl = url;
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Upload impossible");
            return;
          }
        }

        const res = await recordTestExecutionAction({
          testRunId,
          testCaseId: current.id,
          result,
          comment: result === "KO" ? comment.trim() : undefined,
          screenshotUrl,
        });

        if (!res.ok) {
          setError("Erreur lors de l'enregistrement.");
          return;
        }

        if (res.createdBug) {
          const bug: GeneratedBug = res.createdBug;
          setGeneratedBugs((prev) => [...prev, bug]);

          toast.error(
            <div className="flex items-start gap-3 min-w-[280px]">
              <BugIcon className="w-5 h-5 mt-0.5 shrink-0" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Bug créé automatiquement</p>
                <p className="text-xs opacity-90 font-mono mt-0.5">{bug.key}</p>
                <p className="text-xs opacity-90 line-clamp-1">{bug.title}</p>
                <p className="text-[10px] opacity-75 mt-1">
                  Ticket {bug.parentKey} passé en <strong>BLOCKED</strong>
                </p>
              </div>
            </div>,
            {
              duration: 8000,
              action: { label: "Voir", onClick: () => setPreviewBug(bug) },
            }
          );
        } else {
          toast.success("Cas validé", { duration: 1200 });
        }

        setComment("");
        setScreenshot(null);
        setKoMode(false);

        if (index + 1 >= cases.length) {
          // Fin du run → enregistrer puis afficher récap
          const summary = `${cases.length - generatedBugs.length - (result === "KO" ? 1 : 0)} OK, ${
            generatedBugs.length + (result === "KO" ? 1 : 0)
          } KO`;
          finishTestRunAction({ testRunId, summary }).catch(() => {});
          setShowSummary(true);
        } else {
          setIndex((i) => i + 1);
        }
      });
    },
    [cases, comment, current, generatedBugs.length, index, screenshot, testRunId]
  );

  // Raccourcis clavier (désactivés hors mode focus)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showSummary || previewBug) return;
      // Ignore si l'utilisateur est dans un input/textarea
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (!koMode) {
        if (e.key === "o" || e.key === "O") {
          e.preventDefault();
          submit("OK");
        } else if (e.key === "k" || e.key === "K") {
          e.preventDefault();
          setKoMode(true);
        }
      } else if (e.key === "Escape") {
        setKoMode(false);
        setError(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [koMode, previewBug, showSummary, submit]);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header minimal */}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Test Runner
          </p>
          <h1 className="text-base font-semibold font-mono">{ticketKey}</h1>
        </div>
        <div className="flex items-center gap-4 min-w-[260px]">
          <span className="text-sm text-muted-foreground tabular-nums">
            {index + 1} / {cases.length}
          </span>
          <Progress value={progress} className="w-40" />
        </div>
      </header>

      {/* Zone de test */}
      <main className="flex-1 overflow-auto px-8 py-10 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-semibold mb-6">{current.title}</h2>

        {current.preconditions && <Section label="Préconditions">{current.preconditions}</Section>}
        <Section label="Étapes">{current.steps}</Section>
        <Section label="Résultat attendu">{current.expected}</Section>

        {koMode && (
          <div
            className="mt-8 space-y-4 border-l-4 border-destructive pl-4"
            onPaste={(e) => {
              // Cherche une image dans le presse-papiers (Ctrl+V)
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const item of items) {
                if (item.type.startsWith("image/")) {
                  const blob = item.getAsFile();
                  if (!blob) continue;
                  if (blob.size > 5 * 1024 * 1024) {
                    toast.error("Capture trop volumineuse (max 5 Mo)");
                    return;
                  }
                  // Renomme pour avoir un nom lisible
                  const ext = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
                  const renamed = new File([blob], `capture-${Date.now()}.${ext}`, { type: blob.type });
                  setScreenshot(renamed);
                  toast.success("Capture collée");
                  e.preventDefault();
                  return;
                }
              }
            }}
          >
            <Textarea
              placeholder="Décrivez le comportement observé (obligatoire). Astuce : Ctrl+V pour coller une capture d'écran."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={5}
              aria-label="Commentaire KO"
              maxLength={2000}
              autoFocus
            />

            {/* Prévisualisation de la capture collée ou sélectionnée */}
            {screenshot ? (
              <div className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(screenshot)}
                  alt="Aperçu de la capture"
                  className="w-32 h-24 object-cover rounded border"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{screenshot.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(screenshot.size / 1024).toFixed(0)} Ko · {screenshot.type}
                  </p>
                  <button
                    type="button"
                    onClick={() => setScreenshot(null)}
                    className="text-xs text-destructive hover:underline mt-1"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-sm cursor-pointer text-muted-foreground hover:text-foreground">
                <Camera className="w-4 h-4" aria-hidden />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 5 * 1024 * 1024) {
                      toast.error("Fichier trop volumineux (max 5 Mo)");
                      e.target.value = "";
                      return;
                    }
                    setScreenshot(f);
                  }}
                />
                Ajouter une capture (ou Ctrl+V pour coller)
              </label>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </main>

      {/* Actions */}
      <footer className="border-t px-6 py-5 flex items-center justify-center gap-3">
        {!koMode ? (
          <>
            <Button
              size="lg"
              variant="outline"
              className="min-w-[160px] h-14 text-base border-green-500/50 hover:bg-green-500/10"
              onClick={() => submit("OK")}
              disabled={isPending}
            >
              <CheckCircle2 className="mr-2 h-5 w-5 text-green-500" />
              OK
              <kbd className="ml-2 hidden sm:inline text-[10px] px-1 py-0.5 rounded border bg-muted font-mono">
                O
              </kbd>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="min-w-[160px] h-14 text-base border-destructive/50 hover:bg-destructive/10"
              onClick={() => setKoMode(true)}
              disabled={isPending}
            >
              <XCircle className="mr-2 h-5 w-5 text-destructive" />
              KO
              <kbd className="ml-2 hidden sm:inline text-[10px] px-1 py-0.5 rounded border bg-muted font-mono">
                K
              </kbd>
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setKoMode(false)} disabled={isPending}>
              Annuler (Esc)
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="min-w-[200px] h-14"
              onClick={() => submit("KO")}
              disabled={isPending || comment.trim().length === 0}
            >
              Enregistrer le KO
            </Button>
          </>
        )}
      </footer>

      {/* Compteur de bugs créés */}
      {generatedBugs.length > 0 && !showSummary && (
        <button
          type="button"
          onClick={() => setPreviewBug(generatedBugs[generatedBugs.length - 1])}
          className="fixed top-16 right-6 flex items-center gap-2 px-3 py-2 rounded-full bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 transition-colors shadow-sm"
          aria-label={`${generatedBugs.length} bug(s) généré(s)`}
        >
          <BugIcon className="w-4 h-4" aria-hidden />
          <span className="text-sm font-semibold tabular-nums">{generatedBugs.length}</span>
        </button>
      )}

      <BugPreviewDrawer
        bug={previewBug}
        open={!!previewBug}
        onClose={() => setPreviewBug(null)}
      />

      {showSummary && (
        <TestRunSummary cases={cases} generatedBugs={generatedBugs} onClose={onFinished} />
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </h3>
      <div className="whitespace-pre-wrap text-base leading-relaxed">{children}</div>
    </section>
  );
}
