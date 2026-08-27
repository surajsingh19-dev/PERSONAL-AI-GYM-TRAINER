const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "gym.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    height_cm REAL NOT NULL,
    weight_kg REAL NOT NULL,
    age INTEGER NOT NULL,
    sex TEXT,
    level TEXT NOT NULL,
    goal TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  );

  CREATE TABLE IF NOT EXISTS progress_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL,
    log_date TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  );
`);

function upsertProfile(id, profile) {
  const stmt = db.prepare(`
    INSERT INTO profiles (id, height_cm, weight_kg, age, sex, level, goal, updated_at)
    VALUES (@id, @height_cm, @weight_kg, @age, @sex, @level, @goal, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      height_cm = excluded.height_cm,
      weight_kg = excluded.weight_kg,
      age = excluded.age,
      sex = excluded.sex,
      level = excluded.level,
      goal = excluded.goal,
      updated_at = excluded.updated_at
  `);
  stmt.run({ id, updated_at: new Date().toISOString(), ...profile });
  return getProfile(id);
}

function getProfile(id) {
  return db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
}

function savePlan(profileId, planObj) {
  const stmt = db.prepare(`
    INSERT INTO plans (profile_id, plan_json, created_at) VALUES (?, ?, ?)
  `);
  const info = stmt.run(profileId, JSON.stringify(planObj), new Date().toISOString());
  return { id: info.lastInsertRowid, profile_id: profileId, plan: planObj };
}

function getLatestPlan(profileId) {
  const row = db
    .prepare("SELECT * FROM plans WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(profileId);
  if (!row) return null;
  return { id: row.id, created_at: row.created_at, plan: JSON.parse(row.plan_json) };
}

function addProgressLog(profileId, { date, weight_kg, notes }) {
  const stmt = db.prepare(`
    INSERT INTO progress_logs (profile_id, log_date, weight_kg, notes, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(profileId, date, weight_kg, notes || null, new Date().toISOString());
  return { id: info.lastInsertRowid };
}

function listProgressLogs(profileId) {
  return db
    .prepare("SELECT log_date as date, weight_kg, notes FROM progress_logs WHERE profile_id = ? ORDER BY log_date ASC")
    .all(profileId);
}

module.exports = {
  db,
  upsertProfile,
  getProfile,
  savePlan,
  getLatestPlan,
  addProgressLog,
  listProgressLogs,
};
