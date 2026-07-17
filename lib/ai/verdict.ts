import OpenAI from "openai";
import { createHash } from "node:crypto";
import { openDatabase } from "@/lib/db/client";

export const VERDICT_SYSTEM_PROMPT = `You are TankGuard’s fleet-operations investigation assistant.

Assess only the supplied telemetry and transaction data. Describe observed discrepancies as events, not as proof that any person acted improperly.

Use neutral, non-accusatory language. Never state or imply that a driver, employee, or other identified person committed theft, fraud, or misconduct. The assigned driver is context metadata only and must never be the subject of a conclusion.

State uncertainty proportionately. Consider plausible alternatives, including sensor calibration error, delayed telemetry, transaction timing or geocoding error, a third party, and legitimate operational explanations.

Use the anomaly’s supplied neutral display name exactly when referring to its type. Recommended actions must be practical investigation steps, such as reviewing receipts or CCTV, checking GPS and fuel-card records, inspecting the vehicle, or scheduling sensor calibration. Do not recommend disciplinary action.

Return only JSON matching the provided schema. Do not include markdown or extra keys.`;

const verdictSchema = {
  type: "object", additionalProperties: false,
  required: ["classification", "confidence", "explanation", "recommended_action"],
  properties: {
    classification: { type: "string", enum: ["requires_investigation", "likely_data_or_sensor_issue", "insufficient_evidence", "no_issue_identified"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    explanation: { type: "string", minLength: 1, maxLength: 900 },
    recommended_action: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

type Verdict = { classification: "requires_investigation" | "likely_data_or_sensor_issue" | "insufficient_evidence" | "no_issue_identified"; confidence: number; explanation: string; recommended_action: string };

type GpsPoint = { at_utc: string; lat: number; lon: number; speed_kph: number; ignition_on: number };

const knownLocations = [
  { label: "Bolu Dağı rest stop", lat: 40.739, lon: 31.611 },
  { label: "Tuzla depot", lat: 40.816, lon: 29.3 },
  { label: "Ankara terminal", lat: 39.933, lon: 32.86 },
  { label: "İzmir depot", lat: 38.423, lon: 27.142 },
] as const;

function distanceMeters(a: GpsPoint, b: GpsPoint): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latDelta = radians(b.lat - a.lat);
  const lonDelta = radians(b.lon - a.lon);
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lonDelta / 2) ** 2;
  return 6371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function knownLocationLabel(position: GpsPoint | undefined): string {
  if (!position) return "event position";
  const nearest = knownLocations
    .map((location) => ({ location, distance: distanceMeters(position, { at_utc: position.at_utc, lat: location.lat, lon: location.lon, speed_kph: 0, ignition_on: 0 }) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest && nearest.distance <= 2_000 ? nearest.location.label : "event position";
}

export function buildVerdictContext(anomalyId: string): Record<string, unknown> {
  const db = openDatabase();
  try {
    const anomaly = db.prepare(`SELECT a.*, t.plate, t.make_model, t.tank_capacity_liters, t.baseline_l_per_100km, d.full_name AS assigned_driver
      FROM anomalies a JOIN trucks t ON t.id = a.truck_id JOIN drivers d ON d.id = t.assigned_driver_id WHERE a.id = ?`).get(anomalyId) as Record<string, unknown> | undefined;
    if (!anomaly) throw new Error(`Anomaly ${anomalyId} was not found.`);
    const start = String(anomaly.window_start);
    const end = String(anomaly.window_end);
    const tankReadings = db.prepare("SELECT recorded_at AS at_utc, liters FROM tank_readings WHERE truck_id = ? AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at").all(anomaly.truck_id, start, end) as Array<Record<string, unknown>>;
    const gps = db.prepare("SELECT recorded_at AS at_utc, latitude AS lat, longitude AS lon, speed_kph, ignition_on FROM gps_pings WHERE truck_id = ? AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at").all(anomaly.truck_id, start, end) as GpsPoint[];
    const transactions = db.prepare("SELECT occurred_at AS at_utc, station_name, liters, total_cost_try FROM fuel_transactions WHERE truck_id = ? AND occurred_at BETWEEN ? AND ? ORDER BY occurred_at").all(anomaly.truck_id, start, end);
    const sample = <T>(items: T[], max: number) => items.length <= max ? items : items.filter((_, index) => index % Math.ceil(items.length / max) === 0);
    const eventPosition = gps.reduce<GpsPoint | undefined>((nearest, point) => !nearest || Math.abs(new Date(point.at_utc).getTime() - new Date(String(anomaly.occurred_at)).getTime()) < Math.abs(new Date(nearest.at_utc).getTime() - new Date(String(anomaly.occurred_at)).getTime()) ? point : nearest, undefined);
    const parkedPoints = eventPosition ? gps.filter((point) => point.ignition_on === 0 && point.speed_kph <= 2 && distanceMeters(point, eventPosition) <= 100) : [];
    const gpsSummary = anomaly.rule_code === "parked_fuel_loss"
      ? { scope: "parked interval around anomaly", state: "parked", location_label: knownLocationLabel(eventPosition), sample_count: parkedPoints.length, stationary_radius_meters: eventPosition ? Number(Math.max(0, ...parkedPoints.map((point) => distanceMeters(point, eventPosition))).toFixed(1)) : 0, points: sample(parkedPoints, 24) }
      : { scope: "full anomaly window", sample_count: gps.length, points: sample(gps, 24) };
    return {
      task: "Investigate this deterministic fleet anomaly and return the required verdict.",
      anomaly: { id: anomaly.id, display_name: anomaly.display_name, rule: anomaly.rule_code, severity: anomaly.severity, occurred_at_utc: anomaly.occurred_at, window_start_utc: anomaly.window_start, window_end_utc: anomaly.window_end, detector_findings: JSON.parse(String(anomaly.evidence_json)) },
      truck: { id: anomaly.truck_id, plate: anomaly.plate, make_model: anomaly.make_model, tank_capacity_liters: anomaly.tank_capacity_liters, baseline_l_per_100km: anomaly.baseline_l_per_100km, assigned_driver: { name: anomaly.assigned_driver, context_only: true } },
      gps_summary: gpsSummary,
      tank_readings: sample(tankReadings, 32),
      nearby_transactions: transactions,
    };
  } finally { db.close(); }
}

function cachedVerdict(anomalyId: string): Verdict | undefined {
  const db = openDatabase();
  try {
    return db.prepare("SELECT classification, confidence, explanation, recommended_action FROM ai_verdicts WHERE anomaly_id = ?").get(anomalyId) as Verdict | undefined;
  } finally { db.close(); }
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const isReadOnlyDatabaseError = (error: unknown) => error instanceof Error && ("code" in error && error.code === "SQLITE_READONLY" || /readonly database/i.test(error.message));

/**
 * Claims one investigation per anomaly across the web route and standalone scripts.
 * SQLite's unique key makes the claim durable while the model request is in flight.
 */
function claimInvestigation(anomalyId: string): "claimed" | "waiting" | "read_only" {
  const db = openDatabase();
  try {
    db.exec("CREATE TABLE IF NOT EXISTS ai_verdict_jobs (anomaly_id TEXT PRIMARY KEY REFERENCES anomalies(id), created_at TEXT NOT NULL)");
    db.prepare("DELETE FROM ai_verdict_jobs WHERE created_at < ?").run(new Date(Date.now() - 5 * 60_000).toISOString());
    return db.prepare("INSERT OR IGNORE INTO ai_verdict_jobs (anomaly_id, created_at) VALUES (?, ?)").run(anomalyId, new Date().toISOString()).changes === 1 ? "claimed" : "waiting";
  } catch (error) {
    if (isReadOnlyDatabaseError(error)) return "read_only";
    throw error;
  } finally { db.close(); }
}

function releaseInvestigation(anomalyId: string): void {
  const db = openDatabase();
  try { db.prepare("DELETE FROM ai_verdict_jobs WHERE anomaly_id = ?").run(anomalyId); }
  catch (error) { if (!isReadOnlyDatabaseError(error)) throw error; }
  finally { db.close(); }
}

async function waitForVerdict(anomalyId: string): Promise<Verdict> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const cached = cachedVerdict(anomalyId);
    if (cached) return cached;
    await wait(250);
  }
  throw new Error("AI investigation is still in progress. Please try again shortly.");
}

export async function investigateAnomaly(anomalyId: string): Promise<Verdict> {
  const cached = cachedVerdict(anomalyId);
  if (cached) return cached;
  const claim = claimInvestigation(anomalyId);
  if (claim === "waiting") return waitForVerdict(anomalyId);
  if (claim === "read_only") {
    const appearedMeanwhile = cachedVerdict(anomalyId);
    if (appearedMeanwhile) return appearedMeanwhile;
    throw new Error("AI investigation is unavailable because this deployment uses a read-only verdict cache.");
  }

  try {
    // A verdict may have been written between the initial read and lock claim.
    const appearedMeanwhile = cachedVerdict(anomalyId);
    if (appearedMeanwhile) return appearedMeanwhile;
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to investigate anomalies.");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: "gpt-5.6",
      input: [{ role: "system", content: VERDICT_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(buildVerdictContext(anomalyId)) }],
      text: { format: { type: "json_schema", name: "fleet_investigation", strict: true, schema: verdictSchema } },
    });
    const verdict = JSON.parse(response.output_text) as Verdict;
    const writeDb = openDatabase();
    try {
      writeDb.prepare("INSERT OR IGNORE INTO ai_verdicts (id, anomaly_id, classification, confidence, explanation, recommended_action, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        createHash("sha256").update(anomalyId).digest("hex").slice(0, 24), anomalyId, verdict.classification, verdict.confidence, verdict.explanation, verdict.recommended_action, "gpt-5.6", new Date().toISOString(),
      );
      return writeDb.prepare("SELECT classification, confidence, explanation, recommended_action FROM ai_verdicts WHERE anomaly_id = ?").get(anomalyId) as Verdict;
    } catch (error) {
      // Demo deployments ship a complete cache on Vercel's read-only filesystem.
      // If a write becomes unavailable after a model response, still return it to this request.
      if (isReadOnlyDatabaseError(error)) return verdict;
      throw error;
    } finally { writeDb.close(); }
  } finally {
    releaseInvestigation(anomalyId);
  }
}
