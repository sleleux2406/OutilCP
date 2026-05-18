"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Circle,
  MinusCircle,
  PlayCircle,
  Download,
  FileText,
  FileSpreadsheet,
  ChevronRight,
} from "lucide-react";
import type {
  ProjectTestParent,
  ProjectTestCase,
  ListProjectTestsResult,
} from "@/app/actions/project-tests";
import { TestCaseRunnerLauncher } from "./TestCaseRunnerLauncher";

interface Project {
  id: string;
  key: string;
  name: string;
  isRun: boolean;
  parentProject: { key: string; name: string } | null;
}

interface Stats {
  totalCases: number;
  notExecuted: number;
  ok: number;
  ko: number;
  skipped: number;
}

interface Props {
  project: Project;
  parents: ProjectTestParent[];
  stats: Stats;
  canTest: boolean;
  canExport: boolean;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

export function ProjectTestsView({
  project,
  parents,
  stats,
  canTest,
  canExport,
}: Props) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const passRate =
    stats.totalCases > 0
      ? Math.round((stats.ok / stats.totalCases) * 1000) / 10
      : 0;

  return (
    <div className="flex-1 overflow-auto">
      {/* Bandeau stats + bouton export */}
      <div className="border-b bg-muted/20">
        <div className="container max-w-6xl py-4 flex items-center gap-6 flex-wrap">
          <StatPill
            icon={<Circle className="h-4 w-4 text-muted-foreground" />}
            label="Total"
            value={stats.totalCases}
          />
          <StatPill
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            label="OK"
            value={stats.ok}
            color="text-emerald-700"
          />
          <StatPill
            icon={<XCircle className="h-4 w-4 text-red-600" />}
            label="KO"
            value={stats.ko}
            color="text-red-700"
          />
          <StatPill
            icon={<MinusCircle className="h-4 w-4 text-amber-600" />}
            label="Ignores"
            value={stats.skipped}
            color="text-amber-700"
          />
          <StatPill
            icon={<Circle className="h-4 w-4 text-slate-400" />}
            label="Non executes"
            value={stats.notExecuted}
            color="text-slate-600"
          />
          {stats.totalCases > 0 && (
            <div className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Taux de reussite :</span>
              <span
                className={`font-semibold ${
                  passRate >= 90
                    ? "text-emerald-700"
                    : passRate >= 70
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {passRate}%
              </span>
            </div>
          )}
          {canExport && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setExportMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border bg-background hover:bg-accent"
              >
                <Download className="h-4 w-4" />
                Exporter
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${exportMenuOpen ? "rotate-90" : ""}`}
                />
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-popover border rounded-md shadow-md z-20 py-1">
                  <a
                    href={`/api/projects/${project.key}/tests/export?format=md`}
                    onClick={() => setExportMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <FileText className="h-4 w-4" />
                    Telecharger en Markdown
                  </a>
                  <a
                    href={`/api/projects/${project.key}/tests/export?format=csv`}
                    onClick={() => setExportMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Telecharger en CSV (Excel)
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Liste des Features avec leurs Test Cases */}
      <div className="container max-w-6xl py-6 space-y-6">
        {parents.length === 0 ? (
          <div className="border border-dashed rounded-lg p-12 text-center">
            <ClipboardEmpty />
            <h3 className="font-semibold mt-3">Aucun cas de test</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Ce projet n&apos;a pas encore de Features ou User Stories avec des cas
              de test associes.
            </p>
          </div>
        ) : (
          parents.map((parent) => (
            <ParentSection
              key={parent.id}
              parent={parent}
              canTest={canTest}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ClipboardEmpty() {
  return (
    <svg
      className="h-10 w-10 mx-auto text-muted-foreground"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
      />
    </svg>
  );
}

interface StatPillProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: string;
}

function StatPill({ icon, label, value, color = "text-foreground" }: StatPillProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-muted-foreground">{label} :</span>
      <strong className={color}>{value}</strong>
    </div>
  );
}

interface ParentSectionProps {
  parent: ProjectTestParent;
  canTest: boolean;
}

function ParentSection({ parent, canTest }: ParentSectionProps) {
  const typeLabel = parent.type === "FEATURE" ? "Feature" : "User Story";
  const typeBadgeClass =
    parent.type === "FEATURE"
      ? "bg-purple-100 text-purple-800"
      : "bg-amber-100 text-amber-800";

  return (
    <section className="border rounded-lg bg-card overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${typeBadgeClass}`}
        >
          {typeLabel}
        </span>
        <Link
          href={`/tickets/${parent.key}`}
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {parent.key}
        </Link>
        <h2 className="text-sm font-semibold flex-1 truncate">{parent.title}</h2>
        <div className="flex items-center gap-2 text-xs">
          <ResultCounter value={parent.stats.ok} label="OK" color="text-emerald-700" />
          <ResultCounter value={parent.stats.ko} label="KO" color="text-red-700" />
          {parent.stats.notExecuted > 0 && (
            <ResultCounter
              value={parent.stats.notExecuted}
              label="non testes"
              color="text-slate-600"
            />
          )}
        </div>
      </header>
      <ul className="divide-y">
        {parent.testCases.map((tc) => (
          <TestCaseRow
            key={tc.id}
            parent={parent}
            testCase={tc}
            canTest={canTest}
          />
        ))}
      </ul>
    </section>
  );
}

function ResultCounter({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  if (value === 0) return null;
  return (
    <span className={`${color} font-medium`}>
      {value} {label}
    </span>
  );
}

interface TestCaseRowProps {
  parent: ProjectTestParent;
  testCase: ProjectTestCase;
  canTest: boolean;
}

function TestCaseRow({ parent, testCase, canTest }: TestCaseRowProps) {
  const last = testCase.lastExecution;

  return (
    <li className="px-4 py-3 hover:bg-muted/20">
      <div className="flex items-start gap-3">
        <ResultIcon result={last?.result ?? null} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              Cas {testCase.order}
            </span>
            <span className="text-sm font-medium">{testCase.title}</span>
          </div>
          {last ? (
            <div className="mt-1 text-xs text-muted-foreground space-x-2">
              <span>
                <strong className={resultTextClass(last.result)}>
                  {last.result === "OK"
                    ? "Reussi"
                    : last.result === "KO"
                      ? "Echec"
                      : "Ignore"}
                </strong>
              </span>
              <span>·</span>
              <span>{formatDateShort(last.executedAt)}</span>
              <span>·</span>
              <span>par {last.testerName}</span>
              {last.generatedBugKey && (
                <>
                  <span>·</span>
                  <Link
                    href={`/tickets/${last.generatedBugKey}`}
                    className="text-red-600 hover:underline font-mono"
                    title="Voir le bug genere"
                  >
                    Bug {last.generatedBugKey}
                  </Link>
                </>
              )}
              {testCase.executionsCount > 1 && (
                <>
                  <span>·</span>
                  <span>{testCase.executionsCount} executions au total</span>
                </>
              )}
            </div>
          ) : (
            <div className="mt-1 text-xs text-slate-500 italic">
              Jamais execute
            </div>
          )}
          {last?.comment && (
            <div className="mt-1 text-xs text-muted-foreground border-l-2 border-muted pl-2 italic">
              &ldquo;{last.comment.slice(0, 200)}
              {last.comment.length > 200 ? "…" : ""}&rdquo;
            </div>
          )}
        </div>
        {canTest && (
          <TestCaseRunnerLauncher
            ticketId={parent.id}
            ticketKey={parent.key}
          />
        )}
      </div>
    </li>
  );
}

function ResultIcon({ result }: { result: "OK" | "KO" | "SKIPPED" | null }) {
  if (result === "OK") return <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />;
  if (result === "KO") return <XCircle className="h-5 w-5 text-red-600 shrink-0" />;
  if (result === "SKIPPED") return <MinusCircle className="h-5 w-5 text-amber-600 shrink-0" />;
  return <Circle className="h-5 w-5 text-slate-400 shrink-0" />;
}

function resultTextClass(result: "OK" | "KO" | "SKIPPED"): string {
  if (result === "OK") return "text-emerald-700";
  if (result === "KO") return "text-red-700";
  return "text-amber-700";
}
