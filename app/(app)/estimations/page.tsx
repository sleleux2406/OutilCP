import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import {
  listFeaturesToEstimateAction,
  listBugsToEstimateAction,
} from "@/app/actions/estimations";
import { EstimationsList } from "@/components/estimations/EstimationsList";
import { BugEstimationsList } from "@/components/estimations/BugEstimationsList";

export const metadata = {
  title: "Estimations à faire",
};

export default async function EstimationsPage() {
  await requireAuth();

  const [featuresRes, bugsRes] = await Promise.all([
    listFeaturesToEstimateAction(),
    listBugsToEstimateAction(),
  ]);

  const features = featuresRes.ok ? featuresRes.features : [];
  const bugs = bugsRes.ok ? bugsRes.bugs : [];

  const isEmpty = features.length === 0 && bugs.length === 0;

  return (
    <main className="container py-8 max-w-4xl space-y-6">
      <header>
        <div className="inline-flex items-center gap-2 mb-2">
          <Sparkles className="h-5 w-5 text-amber-500" aria-hidden />
          <h1 className="text-2xl font-bold">Estimations à faire</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Features non décomposées et Bugs RUN ouverts non chiffrés. Lancez une session
          d&apos;estimation pour les structurer.
        </p>
      </header>

      {isEmpty ? (
        <div className="border border-dashed rounded-lg p-12 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold">Aucune estimation en attente</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Toutes les Features ont au moins une tâche, et tous les Bugs RUN ont une
            estimation.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 text-sm text-primary hover:underline"
          >
            Retour à l&apos;accueil
          </Link>
        </div>
      ) : (
        <>
          {features.length > 0 && <EstimationsList features={features} />}
          {bugs.length > 0 && <BugEstimationsList bugs={bugs} />}
        </>
      )}
    </main>
  );
}
