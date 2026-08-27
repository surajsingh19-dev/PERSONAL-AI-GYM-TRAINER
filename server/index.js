require("dotenv").config();
const path = require("path");
const express = require("express");

const planRoutes = require("./routes/plan");
const progressRoutes = require("./routes/progress");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/plan", planRoutes);
app.use("/api/progress", progressRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.GEMINI_API_KEY) });
});

app.listen(PORT, () => {
  console.log(`Gym AI agent running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      "WARNING: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
});
