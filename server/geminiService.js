const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const JSON_SHAPE = `{
  "summary": string (2-3 sentence personalized overview),
  "bmi": number,
  "bmi_category": string,
  "daily_calorie_target": integer,
  "macros": { "protein_g": integer, "carbs_g": integer, "fat_g": integer },
  "diet_plan": [
    { "meal": string, "items": [string, ...], "approx_calories": integer, "approx_protein_g": integer }
  ],
  "workout_plan": [
    {
      "day": string (e.g. "Day 1 - Push"),
      "focus": string,
      "exercises": [
        { "name": string, "sets": integer, "reps": string (e.g. "8-12"), "rest_seconds": integer, "notes": string }
      ]
    }
  ],
  "weekly_schedule_note": string,
  "tips": [string, ...] (3-5 items),
  "safety_note": string
}`;

function buildPrompt(profile) {
  const { height_cm, weight_kg, age, sex, level, goal } = profile;
  return `You are a certified strength coach and sports dietitian creating a personalized plan.

Client profile:
- Height: ${height_cm} cm
- Weight: ${weight_kg} kg
- Age: ${age}
- Sex: ${sex || "not specified"}
- Gym proficiency: ${level}
- Primary goal: ${goal}

Instructions:
- Compute their BMI from height and weight.
- Build a realistic daily calorie target and macro split appropriate for their goal, age, and activity level implied by their proficiency.
- Write a full day's diet plan (breakfast, lunch, dinner, and 1-2 snacks) using common, affordable, widely available foods. Give realistic per-meal calorie/protein estimates.
- Write a weekly workout split sized to their proficiency: beginners get simpler full-body sessions with more rest and lower volume; advanced trainees get a more specialized split with higher volume/intensity. Include sets, reps, and rest for every exercise.
- Keep tone encouraging and practical, not generic.
- Include a short safety_note reminding them this is general guidance and not a substitute for medical advice, especially if they have any injuries or conditions.

Respond with ONLY a single valid JSON object (no markdown fences, no commentary before or after) matching exactly this shape:
${JSON_SHAPE}`;
}

// If the primary model is overloaded, fall back to the lighter Flash-Lite
// model rather than making the person wait or fail outright.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 800; // doubles each retry: ~0.8s, 1.6s, 3.2s
const REQUEST_TIMEOUT_MS = 25000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retryable = transient server-side issues, not our fault (overload, timeout, rate limit).
function isRetryable(status) {
  return status === 503 || status === 429 || status === 500;
}

function buildBody(promptText, includeThinkingConfig) {
  const generationConfig = {
    // Ask for JSON output without the stricter responseSchema validator —
    // schema validation differs across model versions/aliases and can
    // reject an otherwise-fine request with a bare, unhelpful
    // "Request contains an invalid argument" 400. The exact JSON shape is
    // spelled out in the prompt instead (see buildPrompt/JSON_SHAPE).
    responseMimeType: "application/json",
    temperature: 0.8,
  };
  if (includeThinkingConfig) {
    // Skip the model's extended "thinking" pass. This plan doesn't need
    // deep multi-step reasoning, and turning it off noticeably cuts
    // response time on models that support it. Not every model accepts
    // this field though (e.g. some Flash-Lite variants reject it with a
    // 400), so callModel() retries once without it if that happens.
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  return {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig,
  };
}

async function doRequest(model, apiKey, body) {
  const url = `${API_BASE}/${model}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error(`Gemini request to ${model} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Gemini API request failed (${res.status}): ${text || res.statusText}`);
    err.status = res.status;
    err.bodyText = text;
    throw err;
  }

  return res.json();
}

async function callModel(model, apiKey, promptText) {
  try {
    return await doRequest(model, apiKey, buildBody(promptText, true));
  } catch (err) {
    // If the model rejects the request with a 400, it's most likely the
    // thinkingConfig field (some Flash-Lite variants don't support it, and
    // the API doesn't always say so explicitly). Retry once without it
    // before giving up on this model.
    if (err.status === 400) {
      return doRequest(model, apiKey, buildBody(promptText, false));
    }
    throw err;
  }
}

// Tries a model with exponential-backoff retries on transient errors, then
// falls through to the next model in the list.
async function callWithRetriesAndFallback(models, apiKey, promptText) {
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await callModel(model, apiKey, promptText);
      } catch (err) {
        lastErr = err;
        const retryable = isRetryable(err.status) || err.status === 504;
        const isLastAttempt = attempt === MAX_RETRIES;
        if (!retryable || isLastAttempt) break; // move to next model (or give up)
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

async function generatePlan(profile) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "GEMINI_API_KEY is not set. Add it to your .env file (see .env.example)."
    );
    err.code = "MISSING_API_KEY";
    throw err;
  }

  const models = MODEL === FALLBACK_MODEL ? [MODEL] : [MODEL, FALLBACK_MODEL];
  const data = await callWithRetriesAndFallback(models, apiKey, buildPrompt(profile));
  const candidate = data.candidates && data.candidates[0];
  const finishReason = candidate && candidate.finishReason;
  const textPart =
    candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];

  if (!textPart || !textPart.text) {
    const err = new Error(
      `Gemini returned no content (finishReason: ${finishReason || "unknown"}).`
    );
    throw err;
  }

  try {
    return JSON.parse(cleanJsonText(textPart.text));
  } catch (e) {
    const err = new Error("Gemini returned malformed JSON.");
    err.raw = textPart.text;
    throw err;
  }
}

// Strips ```json / ``` fences some models add even when told not to.
function cleanJsonText(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

module.exports = { generatePlan };