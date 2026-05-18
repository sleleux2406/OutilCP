"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { startTestRunAction } from "@/app/actions/test-runner";
import { TestRunner, type TestCaseInRunner } from "@/components/test-runner/TestRunner";

interface Props {
  ticketId: string;
  ticketKey: string;
}

/**
 * Bouton compact pour lancer le test runner directement depuis une carte Kanban.
 * Module 2.1 : permet au PO ou Testeur de lancer les tests sans quitter le board.
 *
 * Reutilise le composant TestRunner existant (mode plein ecran focus).
 * Le composant ne s'affiche que pour les Features/US qui ont des cas de test.
 */
export function KanbanTestButton({ ticketId, ticketKey }: Props) {
  const router = useRouter();
  const [runnerState, setRunnerState] = useState<{
    testRunId: string;
    cases: TestCaseInRunner[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    startTransition(async () => {
      const res = await startTestRunAction({ ticketId });
      if (!res.ok) {
        const msg =
          res.error === "NO_CASES"
            ? "Aucun cas de test defini"
            : res.error === "FORBIDDEN"
              ? "Pas de droits suffisants"
              : "Impossible de demarrer le test";
        toast.error(msg);
        return;
      }
      setRunnerState({ testRunId: res.testRunId, cases: res.cases });
    });
  };

  const close = () => {
    setRunnerState(null);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={isPending}
        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300 transition-colors disabled:opacity-50"
        title="Lancer une session de test sur ce ticket"
      >
        {isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <FlaskConical className="w-3 h-3" />
        )}
        Tester
      </button>

      {runnerState && (
        <TestRunner
          testRunId={runnerState.testRunId}
          ticketKey={ticketKey}
          cases={runnerState.cases}
          onFinished={close}
        />
      )}
    </>
  );
}
