const STORAGE_KEY = "attendanceCopilot";
const DAY_INDEX = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

let appState = null;

document.addEventListener("DOMContentLoaded", async () => {
  appState = await loadState();
  bindEvents();
  render();
});

function bindEvents() {
  document.getElementById("settingsForm").addEventListener("submit", saveSettings);
  document.getElementById("saveTimetableButton").addEventListener("click", saveTimetable);
  document.getElementById("importTimetableButton").addEventListener("click", importBulkTimetable);
  document.getElementById("exportStateButton").addEventListener("click", exportState);
  document.getElementById("importManualButton").addEventListener("click", importManualRecords);
  document.getElementById("clearRecordsButton").addEventListener("click", clearRecords);
  
  const importFileInput = document.getElementById("importStateFile");
  document.getElementById("importStateButton").addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", importState);
}

function render() {
  const classCodes = Object.keys(appState.classes || {}).sort();
  const container = document.getElementById("classContextContainer");
  const setupSection = document.getElementById("setup");

  // If the user wiped everything and has no semesters left
  if (!classCodes.length) {
    container.innerHTML = `<span style="color: rgba(255, 255, 255, 0.8); font-size: 13px;">No class synced yet. Please sync from the popup first.</span>`;
    setupSection.style.display = "none"; // Hide the forms
    return;
  }

  // Show the forms and build the dropdown
  setupSection.style.display = "block";
  container.innerHTML = `
    <div style="color: rgba(255, 255, 255, 0.9); font-size: 13px; display: flex; align-items: center; gap: 8px;">
      <span>Configuring:</span>
      <select id="setupClassPicker" style="width: auto; padding: 4px 8px; font-size: 12px; background: rgba(0, 0, 0, 0.2); color: white; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; cursor: pointer;">
        ${classCodes.map(c => `<option value="${escapeHtml(c)}" ${c === getActiveClassCode() ? "selected" : ""} style="color: #000;">${escapeHtml(appState.classes[c].classInfo?.label || c)}</option>`).join("")}
      </select>
    </div>
  `;

  // When the user picks a different semester, update state and re-render
  document.getElementById("setupClassPicker")?.addEventListener("change", (e) => {
    appState.activeClassCode = e.target.value;
    appState.classInfo = getCurrentClassProfile()?.classInfo || null;
    saveState(appState).then(render);
  });

  renderSettings();
  renderTimetable();
}

function renderSettings() {
  const settings = getCurrentSettings();
  const activeKey = settings.activeWindow;
  const active = settings.windows[activeKey];

  document.getElementById("activeWindow").value = activeKey;
  document.getElementById("windowStart").value = active.start || "";
  document.getElementById("windowEnd").value = active.end || "";
  document.getElementById("windowTarget").value = active.target || "";
  document.getElementById("holidays").value = (settings.holidays || []).join("\n");
  
  const specialDaysStr = Object.entries(settings.specialDays || {}).map(([date, day]) => `${date} = ${day}`).join("\n");
  document.getElementById("specialDays").value = specialDaysStr;
}

function renderTimetable() {
  const settings = getCurrentSettings();
  const catalog = getCurrentClassProfile()?.subjectCatalog || {};
  const editor = document.getElementById("timetableEditor");
  
  editor.innerHTML = settings.timetable.map((day) => `
    <div class="day-row">
      <strong>${escapeHtml(day.day)}</strong>
      <div class="slots">
        ${day.slots.map((slot) => {
          const isPlaceholder = slot.subject && slot.subject.includes("_CODE");
          const isCustom = slot.subject && !catalog[slot.subject] && !isPlaceholder;
          const placeholderClass = isPlaceholder ? "is-placeholder" : "";
          
          return `
            <select class="slot-input ${placeholderClass}" data-day="${escapeHtml(day.day)}" data-hour="${slot.hour}">
              <option value="" ${!slot.subject ? "selected" : ""}>- Free -</option>
              ${isPlaceholder ? `<option value="${escapeHtml(slot.subject)}" selected disabled>⚠️ Pick ${escapeHtml(slot.subject.replace("_CODE", ""))}</option>` : ""}
              ${isCustom ? `<option value="${escapeHtml(slot.subject)}" selected>${escapeHtml(slot.subject)}</option>` : ""}
              ${Object.keys(catalog).map(code => {
                const dName = catalog[code].name ? `${code} - ${catalog[code].name}` : code;
                return `<option value="${escapeHtml(code)}" ${slot.subject === code ? "selected" : ""}>${escapeHtml(dName)}</option>`;
              }).join("")}
            </select>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");
}

function saveTimetable() {
  const settings = getCurrentSettings();
  settings.timetable = settings.timetable.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => {
      const input = document.querySelector(`select[data-day="${day.day}"][data-hour="${slot.hour}"]`);
      return { ...slot, subject: input.value };
    })
  }));
  saveState(appState).then(() => { alert("Timetable Saved!"); render(); });
}

function importBulkTimetable() {
  const input = document.getElementById("bulkTimetable");
  const rows = input.value.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (!rows.length) return;

  const settings = getCurrentSettings();
  rows.forEach((line) => {
    const parts = line.split(/,|\t|\|/).map(p => p.trim());
    const dayName = normalizeDayName(parts.shift());
    const day = settings.timetable.find(e => e.day === dayName);
    if (!day) return;

    day.slots = day.slots.map((slot, index) => ({
      ...slot,
      subject: normalizeSubject(parts[index] || "")
    }));
  });

  input.value = "";
  saveState(appState).then(render);
}

function saveSettings(event) {
  event.preventDefault();
  const activeWindow = document.getElementById("activeWindow").value;
  const settings = getCurrentSettings();
  const windowConfig = settings.windows[activeWindow];

  settings.activeWindow = activeWindow;
  windowConfig.start = document.getElementById("windowStart").value;
  windowConfig.end = document.getElementById("windowEnd").value;
  windowConfig.target = Number(document.getElementById("windowTarget").value || windowConfig.target);
  settings.holidays = document.getElementById("holidays").value.split(/\n|,/).map(d => d.trim()).filter(Boolean).sort();
  
  settings.specialDays = {};
  document.getElementById("specialDays").value.split(/\n/).forEach(line => {
    const parts = line.split("=");
    if (parts.length === 2) {
      const date = parts[0].trim();
      const day = normalizeDayName(parts[1].trim());
      if (date && day) settings.specialDays[date] = day;
    }
  });

  saveState(appState).then(() => alert("Settings Saved!"));
}

function importManualRecords() {
  const classCode = getActiveClassCode();
  const rows = document.getElementById("manualRecords").value.split(/\n+/).map(l => l.trim()).filter(Boolean).map(line => {
    const [date, hour, subject, status] = line.split(",").map(p => p.trim());
    return { date, hour: hour ? Number(hour) : null, subject: normalizeSubject(subject), status: String(status || "Absent").trim(), source: "manual", classCode };
  }).filter(r => r.date && r.subject);

  const map = new Map();
  [...appState.records, ...rows].forEach(r => map.set([r.classCode||"", r.date, r.hour||"", r.subject.toLowerCase()].join("|"), r));
  appState.records = [...map.values()];
  
  document.getElementById("manualRecords").value = "";
  saveState(appState).then(() => { alert(`Imported ${rows.length} records.`); render(); });
}

function clearRecords() {
  const classCode = getActiveClassCode();
  if (!confirm(`Are you sure? This will completely delete the timetable, subjects, and all attendance records for ${classCode || "this class"}.`)) return;
  
  // 1. Delete all attendance records for this class
  appState.records = appState.records.filter(r => r.classCode !== classCode);
  
  // 2. Completely delete the class profile (wipes the timetable and settings)
  if (appState.classes && appState.classes[classCode]) {
    delete appState.classes[classCode];
  }
  
  // 3. Reset the active class code so the UI knows it's empty
  appState.activeClassCode = Object.keys(appState.classes || {})[0] || "";
  appState.classInfo = appState.activeClassCode ? appState.classes[appState.activeClassCode].classInfo : null;
  
  saveState(appState).then(() => { 
    alert("Semester data completely wiped."); 
    render(); 
  });
}

function exportState() {
  const dataStr = JSON.stringify(appState, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `haajar-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importState(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const importedState = JSON.parse(e.target.result);
      if (typeof importedState !== "object" || !importedState.settings) throw new Error("Invalid file format.");
      if (confirm("This will overwrite your current data. Proceed?")) {
        appState = normalizeState(importedState);
        await saveState(appState);
        render();
        alert("Data imported successfully.");
      }
    } catch (error) { alert("Failed to import data: " + error.message); } 
    finally { event.target.value = ""; }
  };
  reader.readAsText(file);
}

// --- SHARED HELPERS ---
function getActiveClassCode() { return appState.activeClassCode || appState.classInfo?.classCode || Object.keys(appState.classes || {})[0] || ""; }
function getCurrentClassProfile() { const c = getActiveClassCode(); if (!c) return null; ensureClassProfile(c, appState.classInfo?.classCode === c ? appState.classInfo : null); return appState.classes[c]; }
function getCurrentSettings() { return getCurrentClassProfile()?.settings || appState.settings; }
function ensureClassProfile(c, i = null) { if (!appState.classes) appState.classes = {}; if (!appState.classes[c]) appState.classes[c] = { classInfo: i || { classCode: c }, subjectCatalog: {}, settings: createDefaultSettings() }; if (i) appState.classes[c].classInfo = i; appState.classes[c].settings = normalizeSettings(appState.classes[c].settings); }
function normalizeSubject(s) { const t = String(s || "").replace(/\s+/g, " ").trim(); const sc = [...t.matchAll(/\d+\/([A-Z]{2,}\d{3,}[A-Z0-9-]*)/gi)]; if (sc.length) return sc[sc.length - 1][1].toUpperCase(); const pc = [...t.matchAll(/\b([A-Z]{2,}\d{3,}[A-Z0-9-]*)\b/gi)]; if (pc.length) return pc[pc.length - 1][1].toUpperCase(); return t.replace(/^\d+\//, ""); }
function normalizeDayName(d) { const v = String(d || "").trim().toLowerCase(); return v ? (Object.keys(DAY_INDEX).find((n) => n.toLowerCase().startsWith(v.slice(0, 3))) || Object.keys(DAY_INDEX).find((n) => n.toLowerCase() === v)) || d : d; }
function escapeHtml(v) { return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
async function loadState() { const r = await chrome.storage.local.get(STORAGE_KEY); return normalizeState(r[STORAGE_KEY] || { records: [], subjectCatalog: {}, classInfo: null, settings: createDefaultSettings() }); }
function normalizeState(s) { const n = { records: [], subjectCatalog: {}, classInfo: null, activeClassCode: "", classes: {}, settings: createDefaultSettings(), ...s }; n.subjectCatalog = normalizeSubjectCatalog({ ...(s?.settings?.subjectCatalog || {}), ...(s?.subjectCatalog || {}) }); n.settings = normalizeSettings(s?.settings); n.records = (s?.records || []).map(r => ({ ...r, classCode: r.classCode || s?.classInfo?.classCode || n.activeClassCode || "legacy" })); n.records.forEach(r => ensureClassProfileForState(n, r.classCode, r.classCode === s?.classInfo?.classCode ? s?.classInfo : null)); Object.keys(n.classes).forEach(c => { n.classes[c].settings = normalizeSettings(n.classes[c].settings); n.classes[c].subjectCatalog = normalizeSubjectCatalog(n.classes[c].subjectCatalog || {}); n.classes[c].classInfo = n.classes[c].classInfo || { classCode: c }; }); if (!n.activeClassCode) n.activeClassCode = s?.classInfo?.classCode || Object.keys(n.classes)[0] || ""; if (n.activeClassCode && n.classes[n.activeClassCode]) n.classInfo = n.classes[n.activeClassCode].classInfo; return n; }
function ensureClassProfileForState(s, c, i = null) { if (c && !s.classes[c]) s.classes[c] = { classInfo: i || { classCode: c }, subjectCatalog: {}, settings: cloneSettings(s.settings || createDefaultSettings()) }; }
function createDefaultSettings() { return { activeWindow: "semester", windows: { internal1: { label: "Int 1", start: "", end: "", target: 80 }, internal2: { label: "Int 2", start: "", end: "", target: 80 }, semester: { label: "Sem", start: "", end: "", target: 75 } }, holidays: [], specialDays: {}, timetable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => ({ day: d, slots: Array.from({ length: 7 }, (_, i) => ({ hour: i + 1, subject: "" })) })) }; }
function normalizeSettings(s = {}) { const d = createDefaultSettings(); return { ...d, ...s, windows: { ...d.windows, ...(s?.windows || {}) }, holidays: s?.holidays || [], specialDays: s?.specialDays || {}, timetable: s?.timetable || d.timetable }; }
function cloneSettings(s) { return JSON.parse(JSON.stringify(normalizeSettings(s))); }
function normalizeSubjectCatalog(c) { return Object.fromEntries(Object.entries(c || {}).map(([k, v]) => [normalizeSubject(k), typeof v === "string" ? { name: v, kind: /lab\b/i.test(v) ? "lab" : "theory" } : v])); }
async function saveState(s) { await chrome.storage.local.set({ [STORAGE_KEY]: s }); }