"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { startTestRunAction } from "@/app/actions/test-runner";
import { TestRunner, type TestCaseInRunner } from "@/components/test-runner/TestRunner";

interface Props {
  ticketId: string;
  ticketKey: string;
}

/**
 * Bouton compact pour lancer une session de test depuis la liste des cas
 * de test du projet (page /projects/[key]/tests).
 *
 * Reutilise le composant TestRunner existant via startTestRunAction +
 * monte le runner en plein ecran.
 */
export function TestCaseRunnerLauncher({ ticketId, ticketKey }: Props) {
  const router = useRouter();
  const [runnerState, setRunnerState] = useState<{
    testRunId: string;
    cases: TestCaseInRunner[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const start = () => {
    startTransition(async () => {
      const res = await startTestRunAction({ ticketId });
      if (!res.ok) {
        const msg =
          res.error === "NO_CASES"
            ? "Aucun cas de test defini pour ce ticket"
            : res.error === "FORBIDDEN"
              ? "Ce type de ticket n'est pas testable"
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
        disabled={isPending}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border bg-background hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
        title="Lancer une session de test sur cette Feature"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <PlayCircle className="h-3 w-3 text-emerald-600" />
        )}
        Lancer test
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
