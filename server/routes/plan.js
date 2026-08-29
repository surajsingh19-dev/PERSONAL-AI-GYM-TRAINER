const express = require("express");
const { randomUUID } = require("crypto");
const { upsertProfile, getProfile, savePlan, getLatestPlan } = require("../db");
const { generatePlan } = require("../geminiService");

const router = express.Router();

const LEVELS = ["beginner", "intermediate", "advanced"];
const GOALS = ["lose_fat", "build_muscle", "general_fitness", "strength"];

function validateProfile(body) {
  const errors = [];
  const height_cm = Number(body.height_cm);
  const weight_kg = Number(body.weight_kg);
  const age = Number(body.age);
  const level = String(body.level || "").toLowerCase();
  const goal = String(body.goal || "").toLowerCase();
  const sex = body.sex ? String(body.sex) : null;

  if (!height_cm || height_cm < 100 || height_cm > 250)
    errors.push("height_cm must be between 100 and 250");
  if (!weight_kg || weight_kg < 25 || weight_kg > 400)
    errors.push("weight_kg must be between 25 and 400");
  if (!age || age < 13 || age > 100) errors.push("age must be between 13 and 100");
  if (!LEVELS.includes(level)) errors.push(`level must be one of: ${LEVELS.join(", ")}`);
  if (!GOALS.includes(goal)) errors.push(`goal must be one of: ${GOALS.join(", ")}`);

  return { errors, profile: { height_cm, weight_kg, age, sex, level, goal } };
}

// POST /api/plan  -> creates/updates the profile, calls Gemini, stores + returns the plan
router.post("/", async (req, res) => {
  try {
    let profileId = req.header("x-user-id");
    if (!profileId) profileId = randomUUID();

    const { errors, profile } = validateProfile(req.body);
    if (errors.length) return res.status(400).json({ errors });

    upsertProfile(profileId, profile);

    const plan = await generatePlan(profile);
    const saved = savePlan(profileId, plan);

    res.json({ userId: profileId, plan: saved.plan, createdAt: new Date().toISOString() });
  } catch (err) {
    console.error("Error in POST /api/plan:", err);
    if (err.code === "MISSING_API_KEY") {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in Vercel environment variables. Please set GEMINI_API_KEY in Vercel Project Settings.",
      });
    }
    res.status(502).json({ error: err.message || "Failed to generate plan." });
  }
});

// GET /api/plan/latest -> most recent stored plan for this user, if any
router.get("/latest", (req, res) => {
  try {
    const profileId = req.header("x-user-id");
    if (!profileId) return res.status(400).json({ error: "Missing x-user-id header." });

    const profile = getProfile(profileId);
    const latest = getLatestPlan(profileId);
    if (!latest) return res.json({ plan: null, profile: profile || null });

    res.json({ plan: latest.plan, createdAt: latest.created_at, profile });
  } catch (err) {
    console.error("Error in GET /api/plan/latest:", err);
    res.status(500).json({ error: err.message || "Failed to load latest plan." });
  }
});

module.exports = router;
