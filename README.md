# TankGuard

Fleet fuel intelligence for seeded Turkish trucking data. Deterministic rules flag telemetry discrepancies; GPT-5.6 produces neutral investigation summaries and suggested next steps.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` in the repository root:

   ```dotenv
   OPENAI_API_KEY=your_api_key_here
   ```

   Next.js automatically loads this file for the web app and API routes. The standalone `npm run investigate` script explicitly loads the same `.env.local` file through `dotenv`.

3. Generate deterministic source data and detect discrepancies:

   ```bash
   npm run seed
   npm run detect
   ```

4. Generate and cache GPT-5.6 verdicts, then start the app:

   ```bash
   npm run investigate
   npm run dev
   ```

Open `http://localhost:3000`, then select a truck with a detected event.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run seed` | Rebuild the SQLite database and synthetic source data. |
| `npm run detect` | Run the three deterministic rules and persist event candidates. |
| `npm run investigate` | Generate/cache verdicts for all uncached candidates. |
| `npm run investigate <anomaly-id>` | Generate/cache one verdict. |
| `npm run investigate -- --truck TR-07 --refresh` | Regenerate one truck's cached verdict after a context or prompt change. |
| `npm run dev` | Run the Next.js application. |

## Product language

The application describes events, never accuses people. Assigned drivers appear only as operational context. GPT-5.6 verdicts use neutral language, consider alternatives such as sensor or timing issues, and recommend investigation steps rather than disciplinary action.

## Data note

All data is synthetic. Seed timestamps model Turkey local time (UTC+3) and are stored as ISO 8601 UTC strings in SQLite.

## Deploy to Vercel

The repository includes `data/tankguard.db`, pre-seeded and pre-investigated with all three verdicts. It is deliberately committed for the demo: Vercel's serverless filesystem is read-only at runtime, so cached verdicts render without a write or a live investigation call.

1. Commit the included database along with the application changes, then import the repository into Vercel (or run `vercel` from the repository root).
2. Select the Next.js framework preset. Use the default install command and `npm run build`; no custom build command is required.
3. Add `OPENAI_API_KEY` in **Project Settings → Environment Variables** for Production and Preview. The pre-cached anomaly cards work without it, but the dashboard's natural-language query feature requires it.
4. Deploy. `next.config.ts` explicitly traces `data/tankguard.db` into each server-rendered route and API function.

Do not run `npm run seed`, `npm run detect`, or `npm run investigate` in the Vercel build command: they mutate the SQLite database. Regenerate and investigate the database locally, then commit the updated `data/tankguard.db` before a new deployment.

## Production notes

This is a hackathon build, deliberately simplified for evaluation: SQLite ships with the deployment (verdicts are pre-cached, so the live instance is effectively read-only), detection runs as batch scripts, and there is no authentication or multi-tenancy. A production deployment would separate these concerns: a hosted database such as Postgres for fleet-scale telemetry, detection as a scheduled job triggered on data ingestion with investigation following automatically, streamed GPS and fuel ingestion instead of seeded data, and per-operator authentication. The detection rules, evidence bundling, and verdict pipeline are architected to carry over unchanged.
