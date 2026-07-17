import { notFound } from "next/navigation";
import TruckDetailClient, { type TruckDetail } from "@/components/truck-detail/truck-detail-client";
import { openDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function TruckPage({ params }: { params: Promise<{ truckId: string }> }) {
  const truckId = (await params).truckId;
  const db = openDatabase();
  try {
    const truck = db.prepare("SELECT t.plate, t.make_model, t.tank_capacity_liters, t.baseline_l_per_100km, d.full_name AS assigned_driver FROM trucks t JOIN drivers d ON d.id = t.assigned_driver_id WHERE t.id = ?").get(truckId) as { plate: string; make_model: string; tank_capacity_liters: number; baseline_l_per_100km: number; assigned_driver: string } | undefined;
    if (!truck) notFound();
    const anomalies = (db.prepare("SELECT a.*, v.classification, v.confidence, v.explanation, v.recommended_action FROM anomalies a LEFT JOIN ai_verdicts v ON v.anomaly_id = a.id WHERE a.truck_id = ? ORDER BY a.occurred_at DESC").all(truckId) as Array<Record<string, unknown>>).map((anomaly) => {
      const readings = db.prepare("SELECT recorded_at, liters FROM tank_readings WHERE truck_id = ? AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at").all(truckId, anomaly.window_start, anomaly.window_end);
      const gps = db.prepare("SELECT recorded_at, latitude, longitude, speed_kph, ignition_on FROM gps_pings WHERE truck_id = ? AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at").all(truckId, anomaly.window_start, anomaly.window_end);
      const transactions = db.prepare("SELECT occurred_at, station_name, liters, total_cost_try FROM fuel_transactions WHERE truck_id = ? AND occurred_at BETWEEN ? AND ? ORDER BY occurred_at").all(truckId, anomaly.window_start, anomaly.window_end);
      return { id: String(anomaly.id), display_name: String(anomaly.display_name), severity: String(anomaly.severity), occurred_at: String(anomaly.occurred_at), evidence: JSON.parse(String(anomaly.evidence_json)), verdict: anomaly.classification ? { classification: String(anomaly.classification), confidence: Number(anomaly.confidence), explanation: String(anomaly.explanation), recommended_action: String(anomaly.recommended_action) } : undefined, readings, gps, transactions };
    }) as TruckDetail["anomalies"];
    return <TruckDetailClient detail={{ truck, anomalies }} />;
  } finally { db.close(); }
}
