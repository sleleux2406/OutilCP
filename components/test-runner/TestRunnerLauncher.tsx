"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startTestRunAction } from "@/app/actions/test-runner";
import { TestRunner, type TestCaseInRunner } from "./TestRunner";

interface Props {
  ticketId: string;
  ticketKey: string;
  canTest: boolean;
  hasCases: boolean;
}

/**
 * Bouton "Tester ce ticket" visible uniquement pour TESTER/ADMIN.
 * Ouvre le TestRunner en mode focus après avoir créé le TestRun côté serveur.
 */
export function TestRunnerLauncher({ ticketId, ticketKey, canTest, hasCases }: Props) {
  const router = useRouter();
  const [runnerState, setRunnerState] = useState<{
    testRunId: string;
    cases: TestCaseInRunner[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canTest) return null;

  const start = () => {
    startTransition(async () => {
      const res = await startTestRunAction({ ticketId });
      if (!res.ok) {
        const msg =
          res.error === "NO_CASES"
            ? "Aucun cas de test défini pour ce ticket"
            : res.error === "FORBIDDEN"
            ? "Ce type de ticket n'est pas testable"
            : "Impossible de démarrer le test";
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
      <Button onClick={start} disabled={isPending || !hasCases} className="gap-2">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
        Tester ce ticket
      </Button>

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
