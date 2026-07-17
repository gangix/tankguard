PRAGMA foreign_keys = ON;

-- All timestamps are ISO 8601 UTC strings (for example, 2026-07-16T23:00:00.000Z).
-- The seed simulates Turkey (UTC+3) local events, then converts them to UTC before writing.

CREATE TABLE drivers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  licence_number TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE trucks (
  id TEXT PRIMARY KEY,
  plate TEXT NOT NULL UNIQUE,
  make_model TEXT NOT NULL,
  tank_capacity_liters REAL NOT NULL CHECK (tank_capacity_liters > 0),
  baseline_l_per_100km REAL NOT NULL CHECK (baseline_l_per_100km > 0),
  assigned_driver_id TEXT NOT NULL REFERENCES drivers(id),
  created_at TEXT NOT NULL
);

CREATE TABLE gps_pings (
  id INTEGER PRIMARY KEY,
  truck_id TEXT NOT NULL REFERENCES trucks(id),
  recorded_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_kph REAL NOT NULL CHECK (speed_kph >= 0),
  ignition_on INTEGER NOT NULL CHECK (ignition_on IN (0, 1)),
  UNIQUE (truck_id, recorded_at)
);

CREATE TABLE tank_readings (
  id INTEGER PRIMARY KEY,
  truck_id TEXT NOT NULL REFERENCES trucks(id),
  recorded_at TEXT NOT NULL,
  liters REAL NOT NULL CHECK (liters >= 0),
  UNIQUE (truck_id, recorded_at)
);

CREATE TABLE fuel_transactions (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL REFERENCES trucks(id),
  occurred_at TEXT NOT NULL,
  station_name TEXT NOT NULL,
  station_latitude REAL NOT NULL,
  station_longitude REAL NOT NULL,
  liters REAL NOT NULL CHECK (liters > 0),
  unit_price_try REAL NOT NULL CHECK (unit_price_try > 0),
  total_cost_try REAL NOT NULL CHECK (total_cost_try > 0)
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('truck', 'driver')),
  owner_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE anomalies (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL REFERENCES trucks(id),
  rule_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  occurred_at TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved')),
  created_at TEXT NOT NULL,
  CHECK (window_end >= window_start)
);

CREATE TABLE ai_verdicts (
  id TEXT PRIMARY KEY,
  anomaly_id TEXT NOT NULL UNIQUE REFERENCES anomalies(id),
  classification TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  explanation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE ai_verdict_jobs (
  anomaly_id TEXT PRIMARY KEY REFERENCES anomalies(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_gps_pings_truck_recorded_at ON gps_pings(truck_id, recorded_at);
CREATE INDEX idx_tank_readings_truck_recorded_at ON tank_readings(truck_id, recorded_at);
CREATE INDEX idx_fuel_transactions_truck_occurred_at ON fuel_transactions(truck_id, occurred_at);
CREATE INDEX idx_documents_expires_at ON documents(expires_at);
CREATE INDEX idx_anomalies_truck_occurred_at ON anomalies(truck_id, occurred_at);
