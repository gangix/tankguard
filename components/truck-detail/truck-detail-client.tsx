"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import TankChart from "./tank-chart";

const AnomalyMap = dynamic(() => import("./anomaly-map"), { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-xl bg-slate-800" /> });
const timestampFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });
const investigationUnavailableMessage = <>AI investigation has not been generated yet. Run <code>npm run investigate</code> after configuring OPENAI_API_KEY.</>;

type Verdict = { classification: string; confidence: number; explanation: string; recommended_action: string };

export type TruckDetail = {
  truck: { plate: string; make_model: string; tank_capacity_liters: number; baseline_l_per_100km: number; assigned_driver: string };
  anomalies: Array<{
    id: string; display_name: string; severity: string; occurred_at: string; evidence: Record<string, unknown>; verdict?: Verdict;
    gps: Array<{ recorded_at: string; latitude: number; longitude: number; speed_kph: number; ignition_on: number }>;
    readings: Array<{ recorded_at: string; liters: number }>;
    transactions: Array<{ occurred_at: string; station_name: string; liters: number; total_cost_try: number }>;
  }>;
};

function VerdictCard({ verdict }: { verdict: Verdict }) {
  return <div className="mt-5 rounded-xl bg-slate-950/70 p-4"><p className="text-sm font-medium text-sky-300">AI investigation · {Math.round(verdict.confidence * 100)}% confidence</p><p className="mt-2 text-sm text-slate-400">Assessment: {verdict.classification.replaceAll("_", " ")}</p><p className="mt-2 text-slate-200">{verdict.explanation}</p><p className="mt-3 text-sm text-slate-400">Next step: {verdict.recommended_action}</p></div>;
}

export default function TruckDetailClient({ detail }: { detail: TruckDetail }) {
  const anomaly = detail.anomalies[0];
  const [verdict, setVerdict] = useState<Verdict | undefined>(anomaly?.verdict);
  const [isInvestigating, setIsInvestigating] = useState(Boolean(anomaly && !anomaly.verdict));
  const [investigationFailed, setInvestigationFailed] = useState(false);
  const investigatedAnomalyId = useRef<string | null>(null);

  useEffect(() => {
    if (!anomaly || verdict || investigatedAnomalyId.current === anomaly.id) return;
    investigatedAnomalyId.current = anomaly.id;
    void (async () => {
      try {
        const response = await fetch(`/api/anomalies/${anomaly.id}/investigate`, { method: "POST" });
        if (!response.ok) throw new Error("Investigation request failed.");
        setVerdict(await response.json() as Verdict);
      } catch {
        setInvestigationFailed(true);
      } finally {
        setIsInvestigating(false);
      }
    })();
  }, [anomaly, verdict]);

  return <main className="mx-auto min-h-screen max-w-7xl bg-slate-950 px-6 py-10 text-slate-100">
    <Link href="/" className="text-sm text-sky-400">Back to fleet overview</Link>
    <header className="mt-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm uppercase tracking-[0.2em] text-slate-500">Truck detail</p><h1 className="text-4xl font-semibold">{detail.truck.plate}</h1><p className="mt-2 text-slate-400">{detail.truck.make_model} · {detail.truck.tank_capacity_liters} L tank · Baseline {detail.truck.baseline_l_per_100km} L/100km</p></div><p className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">Assigned driver: {detail.truck.assigned_driver}</p></header>
    {anomaly ? <div className="mt-8 grid gap-6 lg:grid-cols-2"><section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-4 text-lg font-medium">GPS around selected event</h2><AnomalyMap points={anomaly.gps} occurredAt={anomaly.occurred_at}/></section><section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-4 text-lg font-medium">Tank level</h2><TankChart readings={anomaly.readings}/></section><section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 lg:col-span-2"><p className="text-sm text-rose-300">{anomaly.severity.toUpperCase()} · {timestampFormatter.format(new Date(anomaly.occurred_at))}</p><h2 className="mt-1 text-xl font-semibold">{anomaly.display_name}</h2><p className="mt-3 text-sm text-slate-300">Detector findings: {Object.entries(anomaly.evidence).filter(([key]) => !["readings", "reasons"].includes(key)).map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join(" · ")}</p>{verdict ? <VerdictCard verdict={verdict} /> : <div className="mt-5">{isInvestigating && <p className="text-sm font-medium text-sky-300">AI investigation in progress…</p>}{investigationFailed && <p className="text-sm text-slate-400">{investigationUnavailableMessage}</p>}</div>}</section></div> : <p className="mt-10 text-slate-400">No detected anomalies for this truck.</p>}
    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-medium">Refuel transactions</h2><div className="mt-3 space-y-2">{anomaly?.transactions.map((transaction) => <p key={transaction.occurred_at} className="flex justify-between border-b border-slate-800 py-2 text-sm"><span>{transaction.station_name} · {timestampFormatter.format(new Date(transaction.occurred_at))}</span><span>{transaction.liters.toFixed(1)} L · ₺{transaction.total_cost_try.toFixed(0)}</span></p>)}</div></section>
  </main>;
}
