import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type Coordinate = { latitude: number; longitude: number };

const ROOT = process.cwd();
const DATA_DIRECTORY = path.join(ROOT, "data");
const DATABASE_PATH = path.join(DATA_DIRECTORY, "tankguard.db");
const GROUND_TRUTH_PATH = path.join(DATA_DIRECTORY, "ground_truth.json");
const TURKEY_UTC_OFFSET_HOURS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const trucks = [
  ["TR-01", "34 TG 101", "Ford F-MAX", 380, 34.2],
  ["TR-02", "34 TG 102", "Mercedes Actros", 370, 35.1],
  ["TR-03", "34 TG 103", "Volvo FH", 390, 33.6],
  ["TR-04", "34 TG 104", "MAN TGX", 360, 36.4],
  ["TR-05", "34 TG 105", "Scania R450", 400, 32.8],
  ["TR-06", "34 TG 106", "Renault T", 350, 34.0],
  ["TR-07", "34 TG 107", "Ford F-MAX", 360, 35.7],
  ["TR-08", "34 TG 108", "Iveco S-Way", 300, 36.8],
] as const;

const driverNames = [
  "Kemal Aydın", "Elif Demir", "Murat Kaya", "Zeynep Şahin",
  "Burak Yılmaz", "Ayşe Çelik", "Oğuz Arslan", "Deniz Koç",
];

const ISTANBUL_TUZLA: Coordinate = { latitude: 40.816, longitude: 29.3 };
const ANKARA: Coordinate = { latitude: 39.933, longitude: 32.86 };
const IZMIR: Coordinate = { latitude: 38.423, longitude: 27.142 };
const BOLU_REST_STOP: Coordinate = { latitude: 40.739, longitude: 31.611 };
const SAKARYA: Coordinate = { latitude: 40.756, longitude: 30.378 };
const ANKARA_NORTH_STATION: Coordinate = { latitude: 40.246, longitude: 31.903 };

function stationAt(point: Coordinate): { name: string; point: Coordinate } {
  if (point.latitude === ISTANBUL_TUZLA.latitude && point.longitude === ISTANBUL_TUZLA.longitude) {
    return { name: "Tuzla Lojistik İstasyonu", point: ISTANBUL_TUZLA };
  }
  if (point.latitude === ANKARA.latitude && point.longitude === ANKARA.longitude) {
    return { name: "Ankara Terminal İstasyonu", point: ANKARA };
  }
  return { name: "İzmir Bursa Yolu İstasyonu", point: IZMIR };
}

function localTurkeyToUtcIso(day: Date, hour: number, minute = 0): string {
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hour - TURKEY_UTC_OFFSET_HOURS,
      minute,
    ),
  ).toISOString();
}

function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolate(start: Coordinate, end: Coordinate, progress: number): Coordinate {
  return {
    latitude: start.latitude + (end.latitude - start.latitude) * progress,
    longitude: start.longitude + (end.longitude - start.longitude) * progress,
  };
}

function haversineKm(a: Coordinate, b: Coordinate): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function dateOnly(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function seededUnit(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function createDatabase(): Database.Database {
  mkdirSync(DATA_DIRECTORY, { recursive: true });
  if (existsSync(DATABASE_PATH)) rmSync(DATABASE_PATH);
  const db = new Database(DATABASE_PATH);
  db.exec(readFileSync(path.join(ROOT, "lib", "db", "schema.sql"), "utf8"));
  return db;
}

function seed(): void {
  const db = createDatabase();
  const now = new Date();
  const endDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const startDay = addDays(endDay, -29);
  const siphonDay = addDays(startDay, 20);
  const ghostDay = addDays(startDay, 23);
  const createdAt = localTurkeyToUtcIso(startDay, 0);

  const insertDriver = db.prepare("INSERT INTO drivers VALUES (?, ?, ?, ?)");
  const insertTruck = db.prepare("INSERT INTO trucks VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertGps = db.prepare(
    "INSERT INTO gps_pings (truck_id, recorded_at, latitude, longitude, speed_kph, ignition_on) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertTank = db.prepare("INSERT INTO tank_readings (truck_id, recorded_at, liters) VALUES (?, ?, ?)");
  const insertFuel = db.prepare(
    "INSERT INTO fuel_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDocument = db.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?)");

  const writeSeed = db.transaction(() => {
    trucks.forEach(([id, plate, makeModel, capacity, baseline], index) => {
      const driverId = `driver-${String(index + 1).padStart(2, "0")}`;
      insertDriver.run(driverId, driverNames[index], `SRC-${2600 + index}`, createdAt);
      insertTruck.run(id, plate, makeModel, capacity, baseline, driverId, createdAt);

      let tankLevel = capacity * 0.9;
      const truckSpeedFactor = 0.9 + seededUnit(`${id}:speed`) * 0.2;
      for (let dayOffset = 0; dayOffset < 30; dayOffset += 1) {
        const day = addDays(startDay, dayOffset);
        const isSiphonEvent = id === "TR-07" && dateOnly(day) === dateOnly(siphonDay);
        const isNightBeforeSiphonEvent = id === "TR-07" && dateOnly(addDays(day, 1)) === dateOnly(siphonDay);
        const isGhostEvent = id === "TR-08" && dateOnly(day) === dateOnly(ghostDay);
        const isRestDay = !isSiphonEvent && !isGhostEvent && seededUnit(`${id}:${dayOffset}:rest`) < 0.12;
        const routePhase = dayOffset + index;
        const routeEnd = routePhase % 2 === 0 ? ANKARA : IZMIR;
        const directionForward = Math.floor(routePhase / 2) % 2 === 0;
        const routeStart = directionForward ? ISTANBUL_TUZLA : routeEnd;
        const routeFinish = directionForward ? routeEnd : ISTANBUL_TUZLA;

        for (let hour = 0; hour < 8; hour += 1) {
          const point = isSiphonEvent ? BOLU_REST_STOP : routeStart;
          const timestamp = localTurkeyToUtcIso(day, hour);
          insertGps.run(id, timestamp, point.latitude, point.longitude, 0, 0);
          if (isSiphonEvent && hour === 3) tankLevel = Math.max(0, tankLevel - 70);
          insertTank.run(id, timestamp, clamp(tankLevel, 0, capacity).toFixed(1));
        }

        const efficiencyFactor = id === "TR-06" && dayOffset >= 16 ? 1.15 : 1;
        const dailySpeedFactor = 0.94 + seededUnit(`${id}:${dayOffset}:speed`) * 0.12;
        const drivingSpeedKph = 72 * truckSpeedFactor * dailySpeedFactor;
        const expectedDailyConsumption = isRestDay ? 0 : (baseline * efficiencyFactor * drivingSpeedKph * 8) / 100;
        if (!isRestDay && tankLevel < expectedDailyConsumption + capacity * 0.15) {
          const liters = Number((capacity - tankLevel).toFixed(1));
          const station = stationAt(routeStart);
          insertFuel.run(
            `fuel-${id}-${dayOffset}`, id, localTurkeyToUtcIso(day, 7, 55), station.name,
            station.point.latitude, station.point.longitude, liters, 42.5, Number((liters * 42.5).toFixed(2)),
          );
          tankLevel = capacity;
        }

        if (!isRestDay) {
          const consumptionPerPing = (baseline * efficiencyFactor * drivingSpeedKph * (5 / 60)) / 100;
          for (let minutes = 0; minutes <= 8 * 60; minutes += 5) {
            const hour = 8 + Math.floor(minutes / 60);
            const minute = minutes % 60;
            const progress = minutes / (8 * 60);
            let point = interpolate(routeStart, routeFinish, progress);
            if (isGhostEvent && hour === 12 && minute === 0) point = SAKARYA;
            const timestamp = localTurkeyToUtcIso(day, hour, minute);
            insertGps.run(id, timestamp, point.latitude, point.longitude, drivingSpeedKph, 1);
            tankLevel = Math.max(0, tankLevel - consumptionPerPing);
            insertTank.run(id, timestamp, clamp(tankLevel, 0, capacity).toFixed(1));
          }
        }

        for (let hour = 17; hour < 24; hour += 1) {
          const timestamp = localTurkeyToUtcIso(day, hour);
          const parkedPoint = isNightBeforeSiphonEvent ? BOLU_REST_STOP : isRestDay ? routeStart : routeFinish;
          insertGps.run(id, timestamp, parkedPoint.latitude, parkedPoint.longitude, 0, 0);
          insertTank.run(id, timestamp, clamp(tankLevel, 0, capacity).toFixed(1));
        }

        if (isGhostEvent) {
          insertFuel.run(
            "fuel-TR-08-ghost", id, localTurkeyToUtcIso(day, 12), "Ankara Kuzey İstasyonu",
            ANKARA_NORTH_STATION.latitude, ANKARA_NORTH_STATION.longitude, 380, 42.5, 16150,
          );
        }
      }
    });

    const documentOwners = [
      ["doc-01", "truck", "TR-01", "Vehicle inspection", 5],
      ["doc-02", "truck", "TR-04", "Insurance", 12],
      ["doc-03", "driver", "driver-06", "SRC licence", -1],
      ["doc-04", "driver", "driver-02", "Driver licence", 170],
    ] as const;
    documentOwners.forEach(([id, ownerType, ownerId, type, days]) => {
      insertDocument.run(id, ownerType, ownerId, type, localTurkeyToUtcIso(addDays(endDay, days), 12), createdAt);
    });
  });
  writeSeed();

  writeFileSync(
    GROUND_TRUTH_PATH,
    `${JSON.stringify({
      generated_at: new Date().toISOString(),
      events: [
        { truck_id: "TR-07", rule: "parked_fuel_loss", occurred_at: localTurkeyToUtcIso(siphonDay, 3) },
        { truck_id: "TR-08", rule: "location_mismatched_transaction", occurred_at: localTurkeyToUtcIso(ghostDay, 12) },
        { truck_id: "TR-06", rule: "efficiency_deviation", final_period_start: localTurkeyToUtcIso(addDays(startDay, 16), 0) },
      ],
    }, null, 2)}\n`,
  );

  printVerificationSummary(db, siphonDay, ghostDay, startDay);
  db.close();
}

function printVerificationSummary(db: Database.Database, siphonDay: Date, ghostDay: Date, startDay: Date): void {
  const siphonStart = localTurkeyToUtcIso(siphonDay, 1);
  const siphonEnd = localTurkeyToUtcIso(siphonDay, 4);
  const readings = db.prepare(
    "SELECT recorded_at, liters FROM tank_readings WHERE truck_id = 'TR-07' AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at",
  ).all(siphonStart, siphonEnd) as Array<{ recorded_at: string; liters: number }>;
  const atTwo = readings.find((reading) => reading.recorded_at === localTurkeyToUtcIso(siphonDay, 2));
  const atThree = readings.find((reading) => reading.recorded_at === localTurkeyToUtcIso(siphonDay, 3));

  const ghostTimestamp = localTurkeyToUtcIso(ghostDay, 12);
  const transaction = db.prepare("SELECT * FROM fuel_transactions WHERE id = 'fuel-TR-08-ghost'").get() as {
    liters: number; station_name: string; station_latitude: number; station_longitude: number;
  };
  const truckPosition = db.prepare(
    "SELECT latitude, longitude FROM gps_pings WHERE truck_id = 'TR-08' AND recorded_at = ?",
  ).get(ghostTimestamp) as Coordinate;
  const distance = haversineKm(truckPosition, { latitude: transaction.station_latitude, longitude: transaction.station_longitude });

  const weeklyEfficiency = (weekStart: Date): number => {
    const weekEnd = addDays(weekStart, 7);
    const start = localTurkeyToUtcIso(weekStart, 0);
    const end = localTurkeyToUtcIso(weekEnd, 0);
    const readingsForWeek = db.prepare(
      "SELECT liters FROM tank_readings WHERE truck_id = 'TR-06' AND recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at",
    ).all(start, end) as Array<{ liters: number }>;
    const refueled = db.prepare(
      "SELECT COALESCE(SUM(liters), 0) AS liters FROM fuel_transactions WHERE truck_id = 'TR-06' AND occurred_at >= ? AND occurred_at < ?",
    ).get(start, end) as { liters: number };
    const distanceRow = db.prepare(
      "SELECT COALESCE(SUM(speed_kph * (5.0 / 60.0)), 0) AS kilometers FROM gps_pings WHERE truck_id = 'TR-06' AND ignition_on = 1 AND recorded_at >= ? AND recorded_at < ?",
    ).get(start, end) as { kilometers: number };
    const consumed = readingsForWeek[0].liters + refueled.liters - readingsForWeek.at(-1)!.liters;
    return (consumed / distanceRow.kilometers) * 100;
  };

  const firstWeek = weeklyEfficiency(startDay);
  const lastWeek = weeklyEfficiency(addDays(startDay, 23));
  console.log("\nSeed verification summary");
  console.log(`TR-07 — Unexplained fuel loss while parked: ${atTwo!.liters.toFixed(1)} L at 02:00 local -> ${atThree!.liters.toFixed(1)} L at 03:00 local (${(atTwo!.liters - atThree!.liters).toFixed(1)} L drop).`);
  console.log(`TR-08 — Location-mismatched transaction: ${transaction.liters.toFixed(0)} L at ${transaction.station_name}; truck-to-station distance ${distance.toFixed(1)} km.`);
  console.log(`TR-06 — Efficiency deviation from baseline: first-week ${firstWeek.toFixed(1)} L/100km; last-week ${lastWeek.toFixed(1)} L/100km (${(((lastWeek / firstWeek) - 1) * 100).toFixed(1)}% higher).`);
}

seed();
