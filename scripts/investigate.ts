import dotenv from "dotenv";
import { investigateAnomaly } from "../lib/ai/verdict";
import { openDatabase } from "../lib/db/client";

dotenv.config({ path: ".env.local", quiet: true });

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  const truckId = argumentsList.includes("--truck") ? argumentsList[argumentsList.indexOf("--truck") + 1] : undefined;
  const requestedId = truckId ? undefined : argumentsList.find((argument) => !argument.startsWith("--"));
  const includeCached = argumentsList.includes("--all");
  const refresh = argumentsList.includes("--refresh");
  const db = openDatabase();
  const ids = requestedId ? [requestedId] : truckId ? (db.prepare("SELECT id FROM anomalies WHERE truck_id = ? ORDER BY occurred_at").all(truckId) as Array<{ id: string }>).map((row) => row.id) : (db.prepare(includeCached ? "SELECT id FROM anomalies ORDER BY occurred_at" : "SELECT id FROM anomalies WHERE id NOT IN (SELECT anomaly_id FROM ai_verdicts) ORDER BY occurred_at").all() as Array<{ id: string }>).map((row) => row.id);
  if (refresh) ids.forEach((id) => db.prepare("DELETE FROM ai_verdicts WHERE anomaly_id = ?").run(id));
  db.close();
  for (const id of ids) console.log(JSON.stringify(await investigateAnomaly(id), null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
