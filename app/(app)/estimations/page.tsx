import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { listFeaturesToEstimateAction } from "@/app/actions/estimations";
import { EstimationsList } from "@/components/estimations/EstimationsList";

export const metadata = {
  title: "Estimations à faire",
};

export default async function EstimationsPage() {
  await requireAuth();

  const res = await listFeaturesToEstimateAction();
  const features = res.ok ? res.features : [];

  return (
    <main className="container py-8 max-w-4xl space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 mb-2">
          <Sparkles className="h-5 w-5 text-amber-500" aria-hidden />
          <h1 className="text-2xl font-bold">Estimations à faire</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Features qui n&apos;ont pas encore été décomposées en tâches. Lancez une
          session d&apos;estimation pour créer leurs tâches en une seule fois.
        </p>
      </header>

      {features.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold">Aucune feature à estimer</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Toutes les features existantes ont déjà au moins une tâche ou un bug.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 text-sm text-primary hover:underline"
          >
            Retour à l&apos;accueil
          </Link>
        </div>
      ) : (
        <EstimationsList features={features} />
      )}
    </main>
  );
}
