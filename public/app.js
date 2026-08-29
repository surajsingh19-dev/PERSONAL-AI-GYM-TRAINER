const USER_ID_KEY = "ironplan_user_id";

function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-user-id": getUserId(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    throw new Error(`Network error: Could not reach server (${netErr.message})`);
  }

  let data = null;
  const rawText = await res.text();
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errorMsg =
      (data && (data.error || data.errors?.join(", "))) ||
      (rawText && rawText.length < 200 ? rawText : `Request failed with status ${res.status}`);
    throw new Error(errorMsg);
  }

  return data || {};
}

// ---------- Elements ----------
const form = document.getElementById("profile-form");
const generateBtn = document.getElementById("generate-btn");
const formError = document.getElementById("form-error");

const emptyState = document.getElementById("empty-state");
const loadingState = document.getElementById("loading-state");
const planView = document.getElementById("plan-view");

const statRow = document.getElementById("stat-row");
const planSummary = document.getElementById("plan-summary");
const safetyNote = document.getElementById("safety-note");

const tabs = document.getElementById("tabs");
const panels = {
  diet: document.getElementById("panel-diet"),
  workout: document.getElementById("panel-workout"),
  tips: document.getElementById("panel-tips"),
  progress: document.getElementById("panel-progress"),
};

const progressForm = document.getElementById("progress-form");
const progressDateInput = document.getElementById("progress-date");
const progressTableBody = document.getElementById("progress-table-body");
const progressEmpty = document.getElementById("progress-empty");
const progressChartCanvas = document.getElementById("progress-chart");

let chart = null;

// ---------- Tabs ----------
tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  const target = btn.dataset.tab;
  Object.entries(panels).forEach(([key, el]) => {
    el.hidden = key !== target;
  });
  if (target === "progress") loadProgress();
});

// ---------- Rendering ----------
function renderStats(plan) {
  const stats = [
    { label: "BMI", value: plan.bmi?.toFixed?.(1) ?? plan.bmi, unit: plan.bmi_category || "" },
    { label: "Calorie target", value: plan.daily_calorie_target, unit: "kcal/day" },
    { label: "Protein", value: plan.macros?.protein_g, unit: "g" },
    { label: "Carbs", value: plan.macros?.carbs_g, unit: "g" },
    { label: "Fat", value: plan.macros?.fat_g, unit: "g" },
  ];
  statRow.innerHTML = stats
    .map(
      (s) => `
      <div class="stat-chip">
        <div class="label">${s.label}</div>
        <div class="value">${s.value ?? "–"}<span class="unit">${s.unit || ""}</span></div>
      </div>`
    )
    .join("");
}

function getDietBadge(dietType) {
  const norm = String(dietType || "").toLowerCase();
  if (norm === "vegetarian" || (norm.includes("veg") && !norm.includes("non") && !norm.includes("vegan"))) {
    return { label: "Vegetarian Diet", icon: "🌿", tagClass: "tag-veg" };
  }
  if (norm === "vegan" || norm.includes("vegan")) {
    return { label: "Vegan (Plant-Based) Diet", icon: "🌱", tagClass: "tag-vegan" };
  }
  if (norm === "eggetarian" || norm.includes("egg")) {
    return { label: "Eggetarian Diet (Veg + Eggs)", icon: "🥚", tagClass: "tag-eggetarian" };
  }
  return { label: "Non-Vegetarian Diet", icon: "🍗", tagClass: "tag-nonveg" };
}

function renderDiet(plan) {
  const activeDiet = plan.diet_type || (form.elements.diet_type ? form.elements.diet_type.value : "non_vegetarian");
  const badge = getDietBadge(activeDiet);

  const headerHtml = `
    <div class="diet-header-bar">
      <div class="diet-pill ${badge.tagClass}">
        <span class="diet-icon">${badge.icon}</span>
        <span class="diet-name">${escapeHtml(badge.label)}</span>
      </div>
      <span class="diet-caption">Targeted nutrition &amp; clean protein sources</span>
    </div>
  `;

  const mealsHtml = (plan.diet_plan || [])
    .map(
      (m) => `
      <div class="meal-card">
        <div class="meal-card-head">
          <h4>${escapeHtml(m.meal)}</h4>
          <span class="meal-macro">${m.approx_calories ?? "–"} kcal${
        m.approx_protein_g ? " · " + m.approx_protein_g + "g protein" : ""
      }</span>
        </div>
        <ul>${(m.items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");

  panels.diet.innerHTML = headerHtml + mealsHtml;
}

function renderWorkout(plan) {
  const scheduleNote = plan.weekly_schedule_note
    ? `<p class="summary" style="margin-bottom:16px;">${escapeHtml(plan.weekly_schedule_note)}</p>`
    : "";
  const days = (plan.workout_plan || [])
    .map(
      (d) => `
      <div class="day-card">
        <div class="day-card-head">
          <h4>${escapeHtml(d.day)}</h4>
          <span class="focus">${escapeHtml(d.focus || "")}</span>
        </div>
        <table class="exercise-table">
          <thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr></thead>
          <tbody>
            ${(d.exercises || [])
              .map(
                (ex) => `
              <tr>
                <td class="name">${escapeHtml(ex.name)}${
                  ex.notes ? `<br><small style="color:var(--dim)">${escapeHtml(ex.notes)}</small>` : ""
                }</td>
                <td class="mono">${ex.sets ?? "–"}</td>
                <td class="mono">${escapeHtml(String(ex.reps ?? "–"))}</td>
                <td class="mono">${ex.rest_seconds ? ex.rest_seconds + "s" : "–"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    )
    .join("");
  panels.workout.innerHTML = scheduleNote + days;
}

function renderTips(plan) {
  panels.tips.innerHTML = `<ul class="tips-list">${(plan.tips || [])
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join("")}</ul>`;
}

function renderPlan(plan) {
  renderStats(plan);
  planSummary.textContent = plan.summary || "";
  renderDiet(plan);
  renderWorkout(plan);
  renderTips(plan);
  safetyNote.textContent = plan.safety_note || "";

  emptyState.hidden = true;
  loadingState.hidden = true;
  planView.hidden = false;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- Generate plan ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;
  generateBtn.disabled = true;

  emptyState.hidden = true;
  planView.hidden = true;
  loadingState.hidden = false;

  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());

  try {
    const data = await api("/api/plan", { method: "POST", body: payload });
    renderPlan(data.plan);
  } catch (err) {
    loadingState.hidden = true;
    emptyState.hidden = false;
    formError.textContent = err.message;
    formError.hidden = false;
  } finally {
    generateBtn.disabled = false;
  }
});

// ---------- Progress ----------
progressForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(progressForm);
  const payload = Object.fromEntries(fd.entries());
  try {
    await api("/api/progress", { method: "POST", body: payload });
    progressForm.reset();
    progressDateInput.valueAsDate = new Date();
    loadProgress();
  } catch (err) {
    alert(err.message);
  }
});

async function loadProgress() {
  try {
    const { logs } = await api("/api/progress");
    renderProgressTable(logs);
    renderProgressChart(logs);
  } catch (err) {
    console.error(err);
  }
}

function renderProgressTable(logs) {
  progressTableBody.innerHTML = logs
    .slice()
    .reverse()
    .map(
      (l) => `<tr><td>${l.date}</td><td>${l.weight_kg}</td><td>${escapeHtml(l.notes || "")}</td></tr>`
    )
    .join("");
}

function renderProgressChart(logs) {
  progressEmpty.hidden = logs.length > 0;
  if (!logs.length) {
    if (chart) { chart.destroy(); chart = null; }
    return;
  }
  const labels = logs.map((l) => l.date);
  const values = logs.map((l) => l.weight_kg);

  if (chart) chart.destroy();
  chart = new Chart(progressChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Weight (kg)",
          data: values,
          borderColor: "#d6613f",
          backgroundColor: "rgba(214,97,63,0.15)",
          tension: 0.25,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8a8f98" }, grid: { color: "#262a31" } },
        y: { ticks: { color: "#8a8f98" }, grid: { color: "#262a31" } },
      },
    },
  });
}

// ---------- Init: load any existing plan on page load ----------
(async function init() {
  progressDateInput.valueAsDate = new Date();
  try {
    const { plan, profile } = await api("/api/plan/latest");
    if (profile) {
      ["height_cm", "weight_kg", "age", "sex", "level", "goal", "diet_type"].forEach((field) => {
        if (form.elements[field] && profile[field] !== undefined && profile[field] !== null) {
          form.elements[field].value = profile[field];
        }
      });
    }
    if (plan) renderPlan(plan);
  } catch (err) {
    // no existing plan yet, ignore
  }
})();
