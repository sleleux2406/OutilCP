"use client";

import { Bug, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { GeneratedBug, TestCaseInRunner } from "./TestRunner";

interface Props {
  cases: TestCaseInRunner[];
  generatedBugs: GeneratedBug[];
  onClose: () => void;
}

/**
 * Écran récapitulatif affiché en fin de session de test.
 * Liste tous les bugs générés automatiquement avec liens cliquables.
 */
export function TestRunSummary({ cases, generatedBugs, onClose }: Props) {
  const failed = generatedBugs.length;
  const passed = cases.length - failed;

  return (
    <div className="fixed inset-0 z-[60] bg-background/95 backdrop-blur flex items-center justify-center p-6">
      <div className="max-w-2xl w-full bg-card border rounded-xl shadow-lg p-8">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold">Session de test terminée</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {cases.length} cas exécuté{cases.length > 1 ? "s" : ""}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="border rounded-lg p-4 text-center">
            <CheckCircle2 className="w-6 h-6 text-green-600 mx-auto mb-2" aria-hidden />
            <div className="text-3xl font-bold tabular-nums">{passed}</div>
            <div className="text-xs text-muted-foreground uppercase">OK</div>
          </div>
          <div className="border rounded-lg p-4 text-center">
            <XCircle className="w-6 h-6 text-destructive mx-auto mb-2" aria-hidden />
            <div className="text-3xl font-bold tabular-nums text-destructive">{failed}</div>
            <div className="text-xs text-muted-foreground uppercase">KO</div>
          </div>
        </div>

        {generatedBugs.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Bug className="w-4 h-4 text-red-500" aria-hidden />
              Bugs créés automatiquement ({generatedBugs.length})
            </h3>
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {generatedBugs.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-3 p-2.5 border rounded-md hover:bg-muted/50"
                >
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{b.key}</span>
                  <span className="flex-1 text-sm truncate">{b.title}</span>
                  <Link
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                  >
                    Ouvrir <ExternalLink className="w-3 h-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button onClick={onClose}>Retour au ticket</Button>
        </div>
      </div>
    </div>
  );
}
