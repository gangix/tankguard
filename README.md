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
| `npm run dev` | Run the Next.js application. |

## Product language

The application describes events, never accuses people. Assigned drivers appear only as operational context. GPT-5.6 verdicts use neutral language, consider alternatives such as sensor or timing issues, and recommend investigation steps rather than disciplinary action.

## Data note

All data is synthetic. Seed timestamps model Turkey local time (UTC+3) and are stored as ISO 8601 UTC strings in SQLite.
