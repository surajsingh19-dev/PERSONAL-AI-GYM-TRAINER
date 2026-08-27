# IRONPLAN — AI gym + diet planner

A small full-stack app: enter your height, weight, age, and gym proficiency,
and it generates a personalized diet + workout plan using the **Google
Gemini API** (free tier). It also lets you log your weight over time and see
a progress chart.

- **Backend:** Node.js + Express + SQLite (`better-sqlite3`)
- **Frontend:** plain HTML/CSS/JS (no build step), Chart.js for the graph
- **AI:** Gemini API, called server-side so your API key is never exposed to the browser

## 1. Get a free Gemini API key

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with a Google account and click **Create API key**.
3. Copy the key.

The free tier has rate limits (requests per minute/day) but no cost. See
[ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
for current limits.

## 2. Install and configure

```bash
cd gym-ai-agent
npm install
cp .env.example .env
```

Open `.env` and paste your key:

```
GEMINI_API_KEY=your_key_here
```

## 3. Run it

```bash
npm start
```

Then open **http://localhost:3000**.

For auto-restart on file changes during development:

```bash
npm run dev
```

## How it works

- `server/geminiService.js` builds a prompt from the profile and calls
  `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
  with a `responseSchema`, so Gemini returns clean, predictable JSON
  (calorie target, macros, a full day of meals, a weekly workout split,
  tips) instead of free-form text you'd have to parse.
- `server/db.js` stores each profile, every generated plan, and weight log
  entries in a local SQLite file at `server/data/gym.db` (created
  automatically, gitignored).
- There's no login system — the browser generates a random ID on first
  visit (`localStorage`) and sends it as an `x-user-id` header, so your
  plan and progress history persist across visits on the same browser.
  If you want real accounts later, swap that header for a proper auth
  layer; the rest of the API already keys everything off a user id.

## Model name

The `.env.example` defaults to `GEMINI_MODEL=gemini-flash-latest`, a
Google-maintained alias that always points at their current Flash model.
Google occasionally repoints or retires aliases — if you ever get a 404,
check [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
for the current model list and set `GEMINI_MODEL` in `.env` to a specific
version, e.g. `gemini-2.5-flash`.

## Handling "503 UNAVAILABLE" / speed

The free tier sometimes returns `503 UNAVAILABLE` ("model is currently
experiencing high demand") — that's Google's servers being overloaded, not
a bug in this app. `geminiService.js` now handles this automatically:

- **Thinking is turned off** (`thinkingConfig.thinkingBudget: 0`). This
  plan doesn't need multi-step reasoning, and skipping the model's
  internal "thinking" pass measurably cuts response time.
- **Retries with backoff**: on a 503/429/500, it retries the same model up
  to 3 times with increasing delays (~0.8s, 1.6s, 3.2s) before giving up.
- **Falls back to a lighter model**: if the primary model (`GEMINI_MODEL`)
  is still overloaded after retries, it automatically tries
  `GEMINI_FALLBACK_MODEL` (defaults to `gemini-flash-lite-latest`), which
  is smaller and usually has more free capacity.
- **25s timeout** per request so a stuck call fails fast instead of hanging.

If you're still seeing errors after this, it usually means both models are
overloaded at once (rare) or your free-tier rate limit was hit — wait a
minute and try again, or check your usage at
[aistudio.google.com](https://aistudio.google.com).

## Deploying

This is a normal Node/Express app, so it runs on any Node host (Render,
Railway, Fly.io, a VPS, etc.):

1. Set the `GEMINI_API_KEY` and `PORT` environment variables on the host.
2. Run `npm install && npm start`.
3. Make sure the process has write access to `server/data/` (for the
   SQLite file), or point it at a persistent volume/disk on your host.

If you outgrow SQLite (multiple server instances, need concurrent writes
at scale), swap `server/db.js` for Postgres/MySQL — the rest of the app
only talks to the small set of functions it exports, so that's the only
file you'd need to change.

## Project structure

```
gym-ai-agent/
├── server/
│   ├── index.js          # Express app entrypoint
│   ├── db.js              # SQLite schema + queries
│   ├── geminiService.js   # Prompt + Gemini API call
│   ├── routes/
│   │   ├── plan.js        # POST /api/plan, GET /api/plan/latest
│   │   └── progress.js    # POST/GET /api/progress
│   └── data/               # gym.db created here at runtime
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── package.json
├── .env.example
└── README.md
```

## Notes / disclaimer

This app produces general fitness and nutrition guidance from an AI
model. It's not medical advice — anyone with an injury, medical
condition, or specific dietary need should check with a doctor or
registered dietitian before following it.
