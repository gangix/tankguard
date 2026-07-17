# TankGuard — Fleet Fuel Intelligence

**OpenAI Build Week 2026 · Track: Work and Productivity**

## 1. Problem

Trucking SMEs lose significant money to fuel theft and fuel fraud: drivers siphoning fuel from parked trucks, ghost refuels charged to company fuel cards, and gradual consumption drift that goes unnoticed. Operators have GPS data and fuel data, but in separate systems — the fraud is only visible when you cross-reference them.

## 2. What we're building

A web application that ingests truck GPS tracks and fuel data, cross-references them to detect fuel anomalies, uses **GPT-5.6** to investigate and explain each incident in plain language, and lets operators ask natural-language questions about their fleet.

**One-liner:** *Deterministic rules find the smoke; GPT-5.6 investigates the fire.*

## 3. Scope

### In scope (build this)
1. **Fleet dashboard** — list of trucks with status cards (km this month, avg L/100km, fuel cost), anomaly-flagged trucks highlighted red, a "documents expiring soon" widget.
2. **Truck detail view** — map with the GPS track around an anomaly, tank-level chart over time, list of refuel transactions, anomaly cards with GPT-5.6 verdicts.
3. **Anomaly detection engine** (deterministic, runs server-side over the seed data):
   - Rule A — Siphoning: tank level drops > 25 L while ignition is off and position is stationary.
   - Rule B — Ghost/impossible refuel: fuel-card transaction whose station location is > 5 km from the truck's GPS position at that timestamp, OR transaction liters > tank capacity, OR no corresponding tank-level increase.
   - Rule C — Consumption drift: rolling 7-day L/100km exceeds the truck's own 30-day baseline by > 10%.
4. **GPT-5.6 verdict pipeline** — each detected candidate is sent to GPT-5.6 with a context bundle (GPS window, tank readings, transaction data, truck profile). Returns structured JSON: `{classification, confidence, explanation, recommended_action}`. Rendered as an "AI investigation" card.
5. **Natural-language query box** — GPT-5.6 with tool use (function calling) over 3 tools: `get_fleet_stats`, `get_truck_detail`, `list_anomalies`. Must handle English and Turkish queries.
6. **Seed script** — generates all synthetic data (see §5).

### Out of scope (do NOT build)
- Authentication / multi-tenancy
- CRUD for trucks/drivers/documents (data is seeded, read-only)
- Real GPS/fuel integrations, file upload
- Mobile layout beyond basic responsiveness

## 4. Architecture

- **Single Next.js app** (App Router, TypeScript), API routes for backend logic.
- **SQLite** via better-sqlite3 (or Prisma + SQLite) — zero-config for judges.
- **OpenAI SDK** calling **GPT-5.6** (verify exact model string in OpenAI docs) for verdicts + NL queries. API key via `OPENAI_API_KEY` env var.
- **Map:** Leaflet + OpenStreetMap tiles (no API key needed).
- **Charts:** Recharts.
- Everything runs with: `npm install && npm run seed && npm run dev`.

## 5. Synthetic data (seed script)

`npm run seed` regenerates everything deterministically (seeded RNG, parameterized anomalies).

- **8 trucks**, Turkish plates, tank capacity 300–400 L, baseline 32–38 L/100km. 8 assigned drivers.
- **30 days** of history ending yesterday. Routes: İstanbul (Tuzla depot) ⇄ Ankara via TEM/Bolu, and İstanbul ⇄ İzmir via Bursa. Realistic waypoints, ~75 km/h, driver breaks, overnight parking.
- **GPS pings** every 5 min while driving (timestamp, lat/lon, speed, ignition), hourly while parked.
- **Tank-level readings** alongside pings (± sensor noise); **refuel transactions** (station, liters, cost) when tank is low at a depot/station.
- **Documents table** for the dashboard widget: vehicle inspection, insurance, driver licenses/SRC — with 2 expiring within 14 days and 1 expired.

### Planted anomalies (ground truth)
1. **Truck TR-07 — siphoning:** on night N, parked overnight at Bolu Dağı rest stop, tank drops ~70 L between 02:00–03:00, ignition off, GPS stationary.
2. **Truck TR-08 — ghost refuel:** fuel-card transaction of 380 L (tank capacity 300 L) at an Ankara station while GPS places the truck ~150 km away near Sakarya; no tank-level increase.
3. **Truck TR-06 — consumption drift:** L/100km ramps +15% over the final two weeks vs. its own baseline.

Seed script also writes `ground_truth.json` (not shown in UI) so detection can be verified.

## 6. GPT-5.6 integration details

- **Verdicts:** one API call per anomaly candidate. System prompt: senior fleet fraud investigator; respond ONLY in strict JSON. Context bundle kept compact (~2–3 KB): truck profile, the triggering rule, 12 h of tank readings around the event (downsampled), GPS summary (parked/moving, location names), nearby transactions.
- **NL queries:** chat endpoint with function calling; loop until final answer; answer in the language of the question. Cap at 5 tool calls.
- Cache verdicts in DB so the demo doesn't re-call the API on every page load.

- So the language rule: describe events, never accuse persons. Concretely, send Codex an addition to the spec/prompt along these lines:

Anomaly type names: "Unexplained fuel loss while parked" (not "siphoning/theft"), "Location-mismatched transaction" (not "fake refuel by driver"), "Efficiency deviation from baseline."
The GPT-5.6 verdict system prompt gets an explicit instruction: "Use neutral, non-accusatory language. Describe what the data shows and possible explanations (including sensor fault or third-party causes). Never assert that a specific person committed theft or fraud. Frame recommended actions as investigation steps."
Recommended actions phrased as process: "Review with the assigned driver," "check station CCTV/receipts," "schedule a sensor calibration check" — the human investigates, the tool flags.
UI copy: the anomaly card can show the assigned driver as context (fine — the operator needs to know who to talk to), but the driver's name shouldn't be styled as the subject of the accusation. "Assigned driver: Kemal A." in metadata, not "Kemal A. — suspected theft" in red.

Keep "siphoning" only as internal terminology if useful for rule names in code; user-facing text stays neutral.
Bonus: this gives you a great line for the demo video — "the system flags discrepancies and suggests investigation steps; it deliberately never accuses a person, because a tank drop has multiple possible explanations." One sentence, and it signals you've thought about the humans in the loop, which is exactly the kind of judgment that separates a product from a demo.
### Product-language rule

Describe anomaly events, never accuse people. User-facing names are **Unexplained fuel loss while parked**, **Location-mismatched transaction**, and **Efficiency deviation from baseline**. GPT verdicts must use neutral, non-accusatory language; include alternative explanations such as sensor fault or third-party causes; and frame recommended actions as investigation steps. An assigned driver is context metadata only, never the subject of an accusation. Internal rule names may retain technical terms where useful.

## 7. UI notes

- Language: **English UI**, data is Turkish-flavored (plates, station names, routes).
- Dashboard hero: fleet map with truck positions; anomalous trucks pulse red.
- Anomaly card: rule triggered, severity, GPT-5.6 explanation, confidence badge, recommended action.
- Keep styling clean and dark-dashboard professional; no login screen — land directly on the dashboard.

## 8. Demo script (3-minute video, for reference during build)

1. (0:00) Problem: fuel theft in trucking SMEs; builder context (fleet-software side project for the Turkish market).
2. (0:30) Dashboard — TR-07 flagged red. Click in.
3. (0:50) Tank chart shows the overnight 70 L drop; map shows the truck parked at Bolu; GPT-5.6 verdict card explains the siphoning.
4. (1:30) NL query in English ("which truck had the worst fuel efficiency this month and why?"), then one in Turkish.
5. (2:00) How it was built: Codex session walkthrough — spec-driven build, where Codex accelerated, where key decisions were made.
6. (2:50) Close.

## 9. Build milestones (Codex sessions)

1. **Session 1 (Fri/Sat):** scaffold app, DB schema, seed script, verify anomalies visible in raw data.
2. **Session 2 (Sat):** detection rules + GPT-5.6 verdict pipeline + truck detail view (map + chart).
3. **Session 3 (Sun):** dashboard, NL query box, polish, README.
4. Keep the majority of core functionality in ONE main session → that session's `/feedback` ID goes into the submission.

## 10. Submission checklist

- [ ] Public repo (MIT license) or private shared with testing@devpost.com + build-week-event@openai.com
- [ ] README: setup (`npm install && npm run seed && npm run dev`), env vars, sample data note, screenshots
- [ ] README section: "How Codex and GPT-5.6 were used" — build workflow + runtime usage
- [ ] `/feedback` session ID captured
- [ ] Demo video < 3 min, public YouTube, audio covers Codex AND GPT-5.6 usage
- [ ] Deployed demo instance (Vercel) so judges can test without setup
- [ ] Track: **Work and Productivity**
