const express = require("express");
const { addProgressLog, listProgressLogs } = require("../db");

const router = express.Router();

// POST /api/progress -> log a weight entry for the day
router.post("/", (req, res) => {
  try {
    const profileId = req.header("x-user-id");
    if (!profileId) return res.status(400).json({ error: "Missing x-user-id header." });

    const weight_kg = Number(req.body.weight_kg);
    const date = req.body.date || new Date().toISOString().slice(0, 10);
    const notes = req.body.notes ? String(req.body.notes).slice(0, 280) : null;

    if (!weight_kg || weight_kg < 25 || weight_kg > 400) {
      return res.status(400).json({ error: "weight_kg must be between 25 and 400" });
    }

    addProgressLog(profileId, { date, weight_kg, notes });
    res.json({ ok: true, logs: listProgressLogs(profileId) });
  } catch (err) {
    console.error("Error in POST /api/progress:", err);
    res.status(500).json({ error: err.message || "Failed to save progress log." });
  }
});

// GET /api/progress -> full history for the chart
router.get("/", (req, res) => {
  try {
    const profileId = req.header("x-user-id");
    if (!profileId) return res.status(400).json({ error: "Missing x-user-id header." });

    res.json({ logs: listProgressLogs(profileId) });
  } catch (err) {
    console.error("Error in GET /api/progress:", err);
    res.status(500).json({ error: err.message || "Failed to load progress logs." });
  }
});

module.exports = router;
