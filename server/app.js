require("dotenv").config();
const path = require("path");
const express = require("express");

const planRoutes = require("./routes/plan");
const progressRoutes = require("./routes/progress");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/plan", planRoutes);
app.use("/api/progress", progressRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.GEMINI_API_KEY) });
});

module.exports = app;
