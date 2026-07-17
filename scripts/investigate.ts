import dotenv from "dotenv";
import { investigateAnomaly } from "../lib/ai/verdict";
import { openDatabase } from "../lib/db/client";

dotenv.config({ path: ".env.local", quiet: true });

async function main(): Promise<void> {
  const requestedId = process.argv[2];
  const db = openDatabase();
  const ids = requestedId ? [requestedId] : (db.prepare("SELECT id FROM anomalies WHERE id NOT IN (SELECT anomaly_id FROM ai_verdicts) ORDER BY occurred_at").all() as Array<{ id: string }>).map((row) => row.id);
  db.close();
  for (const id of ids) console.log(JSON.stringify(await investigateAnomaly(id), null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
