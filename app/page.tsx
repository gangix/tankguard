import { openDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default function Home() {
  const db = openDatabase();
  const trucks = db.prepare("SELECT t.id, t.plate, t.make_model, COUNT(a.id) AS anomalies FROM trucks t LEFT JOIN anomalies a ON a.truck_id = t.id GROUP BY t.id ORDER BY t.id").all() as Array<{ id: string; plate: string; make_model: string; anomalies: number }>;
  db.close();
  return <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100"><div className="mx-auto max-w-5xl"><p className="text-sm uppercase tracking-[0.2em] text-sky-400">TankGuard</p><h1 className="mt-2 text-4xl font-semibold">Fleet fuel intelligence</h1><p className="mt-3 max-w-2xl text-slate-400">Deterministic telemetry checks identify discrepancies. Investigation cards present neutral evidence and next steps.</p><div className="mt-10 grid gap-4 md:grid-cols-2">{trucks.map((truck) => <a key={truck.id} href={`/trucks/${truck.id}`} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-sky-500"><div className="flex justify-between"><div><h2 className="text-xl font-medium">{truck.plate}</h2><p className="text-sm text-slate-400">{truck.make_model}</p></div><span className={truck.anomalies ? "rounded-full bg-rose-500/20 px-3 py-1 text-sm text-rose-300" : "rounded-full bg-emerald-500/20 px-3 py-1 text-sm text-emerald-300"}>{truck.anomalies ? `${truck.anomalies} event${truck.anomalies > 1 ? "s" : ""}` : "No events"}</span></div></a>)}</div></div></main>;
}
