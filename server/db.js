const path = require("path");
const fs = require("fs");

const isServerless = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.VERCEL_ENV
);

let Database;
if (!isServerless) {
  try {
    Database = require("better-sqlite3");
  } catch (err) {
    console.warn("better-sqlite3 could not be loaded, using in-memory store:", err.message);
  }
}

// In-memory store (used in serverless environments or as fallback)
const memStore = {
  profiles: new Map(),
  plans: new Map(),
  progressLogs: new Map(),
};

const memDb = {
  upsertProfile(id, profile) {
    const record = { id, ...profile, updated_at: new Date().toISOString() };
    memStore.profiles.set(id, record);
    return record;
  },
  getProfile(id) {
    return memStore.profiles.get(id) || null;
  },
  savePlan(profileId, planObj) {
    if (!memStore.plans.has(profileId)) {
      memStore.plans.set(profileId, []);
    }
    const plans = memStore.plans.get(profileId);
    const entry = {
      id: plans.length + 1,
      profile_id: profileId,
      plan_json: JSON.stringify(planObj),
      created_at: new Date().toISOString(),
    };
    plans.push(entry);
    return { id: entry.id, profile_id: profileId, plan: planObj };
  },
  getLatestPlan(profileId) {
    const plans = memStore.plans.get(profileId);
    if (!plans || plans.length === 0) return null;
    const latest = plans[plans.length - 1];
    return { id: latest.id, created_at: latest.created_at, plan: JSON.parse(latest.plan_json) };
  },
  addProgressLog(profileId, { date, weight_kg, notes }) {
    if (!memStore.progressLogs.has(profileId)) {
      memStore.progressLogs.set(profileId, []);
    }
    const logs = memStore.progressLogs.get(profileId);
    const id = logs.length + 1;
    logs.push({
      id,
      profile_id: profileId,
      log_date: date,
      weight_kg,
      notes: notes || null,
      created_at: new Date().toISOString(),
    });
    return { id };
  },
  listProgressLogs(profileId) {
    const logs = memStore.progressLogs.get(profileId) || [];
    return logs
      .slice()
      .sort((a, b) => a.log_date.localeCompare(b.log_date))
      .map((l) => ({ date: l.log_date, weight_kg: l.weight_kg, notes: l.notes }));
  },
};

let sqliteDb = null;
if (!isServerless && Database) {
  try {
    const dataDir = path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "gym.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = OFF");

    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        height_cm REAL,
        weight_kg REAL,
        age INTEGER,
        sex TEXT,
        level TEXT,
        goal TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS progress_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        log_date TEXT NOT NULL,
        weight_kg REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
    `);
    sqliteDb = db;
  } catch (err) {
    console.warn("SQLite initialization failed, using in-memory store:", err.message);
    sqliteDb = null;
  }
}

function ensureProfileStub(profileId) {
  if (!sqliteDb) return;
  try {
    const existing = sqliteDb.prepare("SELECT id FROM profiles WHERE id = ?").get(profileId);
    if (!existing) {
      sqliteDb.prepare(`
        INSERT INTO profiles (id, height_cm, weight_kg, age, sex, level, goal, updated_at)
        VALUES (?, 0, 0, 0, NULL, 'beginner', 'general_fitness', ?)
      `).run(profileId, new Date().toISOString());
    }
  } catch {
    // Ignore
  }
}

function upsertProfile(id, profile) {
  if (!sqliteDb) return memDb.upsertProfile(id, profile);
  const stmt = sqliteDb.prepare(`
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
  if (!sqliteDb) return memDb.getProfile(id);
  return sqliteDb.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
}

function savePlan(profileId, planObj) {
  if (!sqliteDb) return memDb.savePlan(profileId, planObj);
  ensureProfileStub(profileId);
  const stmt = sqliteDb.prepare(`
    INSERT INTO plans (profile_id, plan_json, created_at) VALUES (?, ?, ?)
  `);
  const info = stmt.run(profileId, JSON.stringify(planObj), new Date().toISOString());
  return { id: info.lastInsertRowid, profile_id: profileId, plan: planObj };
}

function getLatestPlan(profileId) {
  if (!sqliteDb) return memDb.getLatestPlan(profileId);
  const row = sqliteDb
    .prepare("SELECT * FROM plans WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(profileId);
  if (!row) return null;
  return { id: row.id, created_at: row.created_at, plan: JSON.parse(row.plan_json) };
}

function addProgressLog(profileId, { date, weight_kg, notes }) {
  if (!sqliteDb) return memDb.addProgressLog(profileId, { date, weight_kg, notes });
  ensureProfileStub(profileId);
  const stmt = sqliteDb.prepare(`
    INSERT INTO progress_logs (profile_id, log_date, weight_kg, notes, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(profileId, date, weight_kg, notes || null, new Date().toISOString());
  return { id: info.lastInsertRowid };
}

function listProgressLogs(profileId) {
  if (!sqliteDb) return memDb.listProgressLogs(profileId);
  return sqliteDb
    .prepare("SELECT log_date as date, weight_kg, notes FROM progress_logs WHERE profile_id = ? ORDER BY log_date ASC")
    .all(profileId);
}

module.exports = {
  upsertProfile,
  getProfile,
  savePlan,
  getLatestPlan,
  addProgressLog,
  listProgressLogs,
};
