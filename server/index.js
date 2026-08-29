const app = require("./app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Gym AI agent running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      "WARNING: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
});
