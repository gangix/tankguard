import { openDatabase } from "@/lib/db/client";

export type DashboardTruck = { id: string; plate: string; make_model: string; latitude: number; longitude: number; recorded_at: string; kilometers: number; l_per_100km: number; fuel_cost_try: number; anomalies: Array<{ id: string; display_name: string }> };
export type DashboardSnapshot = { trucks: DashboardTruck[]; documents: Array<{ id: string; owner_label: string; document_type: string; expires_at: string; state: "expired" | "expiring" }>; totals: { truck_count: number; flagged_count: number; fuel_cost_try: number } };

const DAY = 24 * 60 * 60 * 1000;

function getRange(db: ReturnType<typeof openDatabase>): { start: string; end: string } {
  const row = db.prepare("SELECT MAX(recorded_at) AS end FROM gps_pings").get() as { end: string };
  return { end: row.end, start: new Date(new Date(row.end).getTime() - 30 * DAY).toISOString() };
}

function invalidTransactionIds(db: ReturnType<typeof openDatabase>): Set<string> {
  return new Set((db.prepare("SELECT evidence_json FROM anomalies WHERE rule_code = 'transaction_mismatch'").all() as Array<{ evidence_json: string }>).map((row) => String(JSON.parse(row.evidence_json).transaction_id)));
}

function metricsForTruck(db: ReturnType<typeof openDatabase>, truckId: string, start: string, end: string, invalidTransactions: Set<string>) {
  const gps = db.prepare("SELECT speed_kph FROM gps_pings WHERE truck_id = ? AND recorded_at BETWEEN ? AND ? AND ignition_on = 1").all(truckId, start, end) as Array<{ speed_kph: number }>;
  const tanks = db.prepare("SELECT liters FROM tank_readings WHERE truck_id = ? AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at").all(truckId, start, end) as Array<{ liters: number }>;
  const transactions = db.prepare("SELECT id, liters, total_cost_try FROM fuel_transactions WHERE truck_id = ? AND occurred_at BETWEEN ? AND ?").all(truckId, start, end) as Array<{ id: string; liters: number; total_cost_try: number }>;
  const losses = db.prepare("SELECT evidence_json FROM anomalies WHERE truck_id = ? AND rule_code = 'parked_fuel_loss' AND occurred_at BETWEEN ? AND ?").all(truckId, start, end) as Array<{ evidence_json: string }>;
  const validTransactions = transactions.filter((transaction) => !invalidTransactions.has(transaction.id));
  const kilometers = gps.reduce((total, point) => total + point.speed_kph / 12, 0);
  const excludedLosses = losses.reduce((total, row) => total + Number(JSON.parse(row.evidence_json).observed_drop_liters ?? 0), 0);
  const consumed = tanks.length > 1 ? tanks[0].liters + validTransactions.reduce((total, transaction) => total + transaction.liters, 0) - tanks.at(-1)!.liters - excludedLosses : 0;
  return { kilometers: Number(kilometers.toFixed(0)), l_per_100km: kilometers ? Number(((consumed / kilometers) * 100).toFixed(1)) : 0, fuel_cost_try: Number(validTransactions.reduce((total, transaction) => total + transaction.total_cost_try, 0).toFixed(0)) };
}

export function getDashboardSnapshot(): DashboardSnapshot {
  const db = openDatabase();
  try {
    const { start, end } = getRange(db);
    const invalidTransactions = invalidTransactionIds(db);
    const rows = db.prepare(`SELECT t.id, t.plate, t.make_model, p.latitude, p.longitude, p.recorded_at
      FROM trucks t JOIN gps_pings p ON p.truck_id = t.id
      WHERE p.recorded_at = (SELECT MAX(recorded_at) FROM gps_pings WHERE truck_id = t.id) ORDER BY t.id`).all() as Array<Omit<DashboardTruck, "kilometers" | "l_per_100km" | "fuel_cost_try" | "anomalies">>;
    const trucks = rows.map((truck) => ({ ...truck, ...metricsForTruck(db, truck.id, start, end, invalidTransactions), anomalies: db.prepare("SELECT id, display_name FROM anomalies WHERE truck_id = ? ORDER BY occurred_at DESC").all(truck.id) as Array<{ id: string; display_name: string }> }));
    const documents = (db.prepare("SELECT d.id, d.document_type, d.expires_at, CASE WHEN d.owner_type = 'truck' THEN t.plate ELSE dr.full_name END AS owner_label FROM documents d LEFT JOIN trucks t ON d.owner_type = 'truck' AND d.owner_id = t.id LEFT JOIN drivers dr ON d.owner_type = 'driver' AND d.owner_id = dr.id WHERE d.expires_at < ? ORDER BY d.expires_at").all(new Date(new Date(end).getTime() + 14 * DAY).toISOString()) as Array<{ id: string; owner_label: string; document_type: string; expires_at: string }>).map((document) => ({ ...document, state: new Date(document.expires_at).getTime() < new Date(end).getTime() ? "expired" as const : "expiring" as const }));
    return { trucks, documents, totals: { truck_count: trucks.length, flagged_count: trucks.filter((truck) => truck.anomalies.length > 0).length, fuel_cost_try: trucks.reduce((total, truck) => total + truck.fuel_cost_try, 0) } };
  } finally { db.close(); }
}

export function getTruckQueryDetail(truckId: string) {
  const snapshot = getDashboardSnapshot();
  const truck = snapshot.trucks.find((item) => item.id === truckId);
  if (!truck) return { error: "Truck not found" };
  const db = openDatabase();
  try {
    const profile = db.prepare("SELECT t.plate, t.make_model, t.tank_capacity_liters, t.baseline_l_per_100km, d.full_name AS assigned_driver FROM trucks t JOIN drivers d ON d.id = t.assigned_driver_id WHERE t.id = ?").get(truckId);
    const anomalies = db.prepare("SELECT a.display_name, a.occurred_at, a.evidence_json, v.classification, v.explanation, v.recommended_action FROM anomalies a LEFT JOIN ai_verdicts v ON v.anomaly_id = a.id WHERE a.truck_id = ? ORDER BY a.occurred_at DESC").all(truckId) as Array<Record<string, unknown>>;
    return { profile, last_30_days: { kilometers: truck.kilometers, average_l_per_100km: truck.l_per_100km, fuel_cost_try: truck.fuel_cost_try }, anomalies: anomalies.map((anomaly) => ({ ...anomaly, evidence: JSON.parse(String(anomaly.evidence_json)), evidence_json: undefined })) };
  } finally { db.close(); }
}

export function listAnomalyQuery(truckId?: string, ruleCode?: string, limit = 10) {
  const db = openDatabase();
  try {
    const rows = db.prepare("SELECT a.id, a.truck_id, t.plate, a.display_name, a.occurred_at, a.severity, a.evidence_json, v.classification, v.explanation, v.recommended_action FROM anomalies a JOIN trucks t ON t.id = a.truck_id LEFT JOIN ai_verdicts v ON v.anomaly_id = a.id WHERE (? IS NULL OR a.truck_id = ?) AND (? IS NULL OR a.rule_code = ?) ORDER BY a.occurred_at DESC LIMIT ?").all(truckId ?? null, truckId ?? null, ruleCode ?? null, ruleCode ?? null, Math.min(Math.max(limit, 1), 20)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ...row, evidence: JSON.parse(String(row.evidence_json)), evidence_json: undefined }));
  } finally { db.close(); }
}
