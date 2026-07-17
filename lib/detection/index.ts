import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { openDatabase } from "@/lib/db/client";

type Truck = { id: string; tank_capacity_liters: number; baseline_l_per_100km: number };
type GpsPing = { recorded_at: string; latitude: number; longitude: number; speed_kph: number; ignition_on: number };
type TankReading = { recorded_at: string; liters: number };
type Transaction = { id: string; occurred_at: string; station_name: string; station_latitude: number; station_longitude: number; liters: number };
type Candidate = { id: string; truckId: string; ruleCode: string; displayName: string; severity: "medium" | "high"; occurredAt: string; windowStart: string; windowEnd: string; evidence: Record<string, unknown> };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const toMs = (iso: string) => new Date(iso).getTime();
const toIso = (ms: number) => new Date(ms).toISOString();

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latDelta = radians(b.latitude - a.latitude);
  const lonDelta = radians(b.longitude - a.longitude);
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function candidateId(ruleCode: string, truckId: string, occurredAt: string): string {
  return createHash("sha256").update(`${ruleCode}:${truckId}:${occurredAt}`).digest("hex").slice(0, 24);
}

function createCandidate(input: Omit<Candidate, "id">): Candidate {
  return { ...input, id: candidateId(input.ruleCode, input.truckId, input.occurredAt) };
}

function between<T extends { recorded_at: string }>(items: T[], start: number, end: number): T[] {
  return items.filter((item) => toMs(item.recorded_at) >= start && toMs(item.recorded_at) < end);
}

function detectParkedFuelLoss(truck: Truck, gps: GpsPing[], tanks: TankReading[]): Candidate[] {
  const gpsByTime = new Map(gps.map((ping) => [ping.recorded_at, ping]));
  const candidates: Candidate[] = [];
  let inLossEpisode = false;
  for (let index = 1; index < tanks.length; index += 1) {
    const previous = tanks[index - 1];
    const current = tanks[index];
    const loss = previous.liters - current.liters;
    const previousGps = gpsByTime.get(previous.recorded_at);
    const currentGps = gpsByTime.get(current.recorded_at);
    const stationary = previousGps && currentGps && previousGps.ignition_on === 0 && currentGps.ignition_on === 0 && previousGps.speed_kph <= 2 && currentGps.speed_kph <= 2 && distanceKm(previousGps, currentGps) <= 0.1;
    if (loss > 25 && stationary) {
      if (!inLossEpisode) {
        const occurredAt = current.recorded_at;
        candidates.push(createCandidate({
          truckId: truck.id, ruleCode: "parked_fuel_loss", displayName: "Unexplained fuel loss while parked", severity: loss >= 50 ? "high" : "medium", occurredAt,
          windowStart: toIso(toMs(occurredAt) - 6 * HOUR), windowEnd: toIso(toMs(occurredAt) + 6 * HOUR),
          evidence: { observed_drop_liters: Number(loss.toFixed(1)), threshold_liters: 25, ignition_off: true, stationary_distance_meters: Number((distanceKm(previousGps, currentGps) * 1000).toFixed(1)), readings: [previous, current] },
        }));
      }
      inLossEpisode = true;
    } else {
      inLossEpisode = false;
    }
  }
  return candidates;
}

function detectTransactions(truck: Truck, gps: GpsPing[], tanks: TankReading[], transactions: Transaction[]): Candidate[] {
  return transactions.flatMap((transaction) => {
    const timestamp = toMs(transaction.occurred_at);
    const position = gps.filter((ping) => Math.abs(toMs(ping.recorded_at) - timestamp) <= 15 * 60 * 1000).sort((a, b) => Math.abs(toMs(a.recorded_at) - timestamp) - Math.abs(toMs(b.recorded_at) - timestamp))[0];
    const before = tanks.filter((reading) => toMs(reading.recorded_at) <= timestamp && timestamp - toMs(reading.recorded_at) <= 90 * 60 * 1000).at(-1);
    const after = tanks.find((reading) => toMs(reading.recorded_at) >= timestamp && toMs(reading.recorded_at) - timestamp <= 90 * 60 * 1000);
    const reasons: string[] = [];
    const distance = position ? distanceKm(position, { latitude: transaction.station_latitude, longitude: transaction.station_longitude }) : null;
    if (!position) reasons.push("no GPS position within 15 minutes");
    if (distance !== null && distance > 5) reasons.push(`station is ${distance.toFixed(1)} km from truck position`);
    if (transaction.liters > truck.tank_capacity_liters) reasons.push(`transaction volume ${transaction.liters.toFixed(1)} L exceeds ${truck.tank_capacity_liters.toFixed(1)} L tank capacity`);
    const increase = before && after ? after.liters - before.liters : null;
    const expectedIncrease = Math.max(10, transaction.liters * 0.5);
    if (increase === null || increase < expectedIncrease) reasons.push("no corresponding tank-level increase");
    if (reasons.length === 0) return [];
    return [createCandidate({
      truckId: truck.id, ruleCode: "transaction_mismatch", displayName: "Location-mismatched transaction", severity: transaction.liters > truck.tank_capacity_liters || (distance ?? 0) > 50 ? "high" : "medium", occurredAt: transaction.occurred_at,
      windowStart: toIso(timestamp - 6 * HOUR), windowEnd: toIso(timestamp + 6 * HOUR),
      evidence: { transaction_id: transaction.id, station_name: transaction.station_name, transaction_liters: transaction.liters, tank_capacity_liters: truck.tank_capacity_liters, distance_km: distance === null ? null : Number(distance.toFixed(1)), tank_increase_liters: increase === null ? null : Number(increase.toFixed(1)), required_tank_increase_liters: expectedIncrease, reasons },
    })];
  });
}

function detectEfficiencyDeviation(truck: Truck, gps: GpsPing[], tanks: TankReading[], transactions: Transaction[], parkedLosses: Candidate[], transactionAnomalies: Candidate[]): Candidate[] {
  const firstTimestamp = toMs(tanks[0].recorded_at);
  let active = false;
  const candidates: Candidate[] = [];
  for (let day = 7; day <= 30; day += 1) {
    const end = firstTimestamp + day * DAY;
    const start = end - 7 * DAY;
    const readings = between(tanks, start, end);
    if (readings.length < 2) continue;
    const kilometers = between(gps, start, end).filter((ping) => ping.ignition_on === 1).reduce((total, ping) => total + ping.speed_kph * (5 / 60), 0);
    const excludedTransactionIds = new Set(transactionAnomalies.map((anomaly) => String(anomaly.evidence.transaction_id)));
    const fuelAdded = transactions.filter((transaction) => toMs(transaction.occurred_at) >= start && toMs(transaction.occurred_at) < end && !excludedTransactionIds.has(transaction.id)).reduce((total, transaction) => total + transaction.liters, 0);
    const excludedParkedLoss = parkedLosses.filter((loss) => toMs(loss.occurredAt) >= start && toMs(loss.occurredAt) < end).reduce((total, loss) => total + Number(loss.evidence.observed_drop_liters), 0);
    const consumed = readings[0].liters + fuelAdded - readings.at(-1)!.liters - excludedParkedLoss;
    const lPer100km = (consumed / kilometers) * 100;
    const exceeds = lPer100km > truck.baseline_l_per_100km * 1.1;
    if (exceeds && !active) {
      const occurredAt = toIso(end - 1);
      candidates.push(createCandidate({
        truckId: truck.id, ruleCode: "efficiency_deviation", displayName: "Efficiency deviation from baseline", severity: "medium", occurredAt, windowStart: toIso(start), windowEnd: toIso(end),
        evidence: { rolling_l_per_100km: Number(lPer100km.toFixed(1)), baseline_l_per_100km: truck.baseline_l_per_100km, deviation_percent: Number((((lPer100km / truck.baseline_l_per_100km) - 1) * 100).toFixed(1)), driven_km: Number(kilometers.toFixed(1)), consumed_liters: Number(consumed.toFixed(1)), excluded_parked_loss_liters: Number(excludedParkedLoss.toFixed(1)) },
      }));
    }
    active = exceeds;
  }
  return candidates;
}

function persist(db: Database.Database, candidates: Candidate[]): void {
  db.transaction(() => {
    db.prepare("DELETE FROM ai_verdicts").run();
    db.prepare("DELETE FROM anomalies").run();
    const insert = db.prepare("INSERT INTO anomalies (id, truck_id, rule_code, display_name, severity, occurred_at, window_start, window_end, evidence_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)");
    const createdAt = new Date().toISOString();
    candidates.forEach((candidate) => insert.run(candidate.id, candidate.truckId, candidate.ruleCode, candidate.displayName, candidate.severity, candidate.occurredAt, candidate.windowStart, candidate.windowEnd, JSON.stringify(candidate.evidence), createdAt));
  })();
}

export function runDetection(): Candidate[] {
  const db = openDatabase();
  try {
    const trucks = db.prepare("SELECT id, tank_capacity_liters, baseline_l_per_100km FROM trucks ORDER BY id").all() as Truck[];
    const allCandidates: Candidate[] = [];
    for (const truck of trucks) {
      const gps = db.prepare("SELECT recorded_at, latitude, longitude, speed_kph, ignition_on FROM gps_pings WHERE truck_id = ? ORDER BY recorded_at").all(truck.id) as GpsPing[];
      const tanks = db.prepare("SELECT recorded_at, liters FROM tank_readings WHERE truck_id = ? ORDER BY recorded_at").all(truck.id) as TankReading[];
      const transactions = db.prepare("SELECT id, occurred_at, station_name, station_latitude, station_longitude, liters FROM fuel_transactions WHERE truck_id = ? ORDER BY occurred_at").all(truck.id) as Transaction[];
      const parkedLosses = detectParkedFuelLoss(truck, gps, tanks);
      const transactionAnomalies = detectTransactions(truck, gps, tanks, transactions);
      allCandidates.push(...parkedLosses, ...transactionAnomalies, ...detectEfficiencyDeviation(truck, gps, tanks, transactions, parkedLosses, transactionAnomalies));
    }
    persist(db, allCandidates);
    return allCandidates;
  } finally {
    db.close();
  }
}
