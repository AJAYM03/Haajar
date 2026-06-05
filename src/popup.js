const STORAGE_KEY = "attendanceCopilot";
const DAY_INDEX = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

let appState = null;

document.addEventListener("DOMContentLoaded", async () => {
  appState = await loadState();
  bindEvents();
  render();
});

function bindEvents() {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));
  document.getElementById("syncButton").addEventListener("click", syncFromPortal);
  document.getElementById("leaveForm").addEventListener("submit", simulateLeave);
  document.getElementById("openSetupButton").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/setup.html") }));
  
  const select = document.getElementById("semesterSelect");
  select.addEventListener("change", async (e) => {
    appState.activeClassCode = e.target.value;
    await saveState(appState);
    render();
  });
}

function switchView(viewName) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === viewName));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("is-active", v.id === viewName));
}

async function syncFromPortal() {
  const button = document.getElementById("syncButton");
  if (button.disabled) return; 
  button.disabled = true; button.textContent = "Syncing";
  setSyncStatus("Injecting scanner...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active browser tab found.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content.js"] });
    setSyncStatus("Reading portal...");
    const [scanResult] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.AttendanceCopilotScanner?.scan ? window.AttendanceCopilotScanner.scan() : { ok: false, error: "Scanner failed." } });
    const res = scanResult?.result;
    if (!res?.ok) throw new Error(res?.error || "Could not read page.");
    
    // Send to background for robust saving
    const saved = await chrome.runtime.sendMessage({ type: "HAAJAR_BG_SYNC", payload: res });
    if (!saved?.success) throw new Error(saved?.msg || "Sync scanned the page, but saving failed.");
    
    // Reload state and re-render
    appState = await loadState();
    render();
    setSyncStatus(syncSuccessMessage(res), "success");
  } catch (error) { setSyncStatus(error.message, "error"); } 
  finally { button.disabled = false; button.textContent = "Sync"; }
}

function setSyncStatus(msg, type = "") {
  const el = document.getElementById("syncStatus");
  el.textContent = msg || "";
  el.className = ["sync-status", msg ? "is-visible" : "", type ? `is-${type}` : ""].filter(Boolean).join(" ");
}

function syncSuccessMessage(res) {
  if (res.records.length > 0) return `Imported ${res.records.length} records.`;
  if (res.holidays?.length > 0) return `Synced ${res.holidays.length} holidays.`;
  if (Object.keys(res.subjectCatalog || {}).length > 0) return `Synced Subjects.`;
  return "Synced.";
}

function simulateLeave(event) {
  event.preventDefault();
  const simRecs = generateLeaveRecords(document.getElementById("leaveStart").value, document.getElementById("leaveEnd").value);
  renderSubjectCards(document.getElementById("simulationResult"), calculateSubjects(simRecs), "after planned leave");
}

function render() {
  const activeCode = appState.activeClassCode;
  
  // Populate the Dropdown
  const select = document.getElementById("semesterSelect");
  select.innerHTML = Object.keys(appState.classes || {}).sort().map(c => 
    `<option value="${c}" ${c === activeCode ? "selected" : ""}>${c}</option>`
  ).join("");

  if (!activeCode || !appState.classes[activeCode]) {
    document.getElementById("subjectList").innerHTML = `<div class="panel empty" style="text-align: left;"><h3>Setup Required</h3><p>Please open Setup and paste your CSV.</p></div>`;
    return;
  }

  // ... inside render() ...
  const cls = appState.classes[activeCode];
  const activeWinKey = cls.settings.activeWindow || "semester";
  const win = cls.settings.windows[activeWinKey] || { target: 75 };
  const winNames = { internal1: "Internal 1", internal2: "Internal 2", semester: "Semester" };

  document.getElementById("windowNameLabel").textContent = `${winNames[activeWinKey]} View`;
  document.getElementById("targetLabel").textContent = `${win.target}% Target`;
  document.getElementById("recordCount").textContent = String((appState.records || []).filter(r => r.classCode === activeCode).length);
// ...
  
  renderSubjectCards(document.getElementById("subjectList"), calculateSubjects());

  const simStart = document.getElementById("leaveStart");
  const simEnd = document.getElementById("leaveEnd");
  if (simStart && simEnd && cls.settings.windows.semester.start && cls.settings.windows.semester.end) {
    simStart.min = cls.settings.windows.semester.start; simStart.max = cls.settings.windows.semester.end;
    simEnd.min = cls.settings.windows.semester.start; simEnd.max = cls.settings.windows.semester.end;
  }

  const syncMetaEl = document.getElementById("syncMeta");
  if (cls.lastSync && cls.lastSync.scannedAt) {
    const d = new Date(cls.lastSync.scannedAt);
    syncMetaEl.textContent = `Last synced: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } else {
    syncMetaEl.textContent = "No portal sync yet";
  }

}

function renderSubjectCards(container, subjects, suffix = "") {
  if (!subjects.length) {
    container.innerHTML = `<div class="panel empty" style="text-align: left;"><h3>Setup Required</h3><p>Timetable or dates missing. Please open Setup.</p></div>`;
    return;
  }
  container.innerHTML = subjects.map(s => {
    const stat = getRiskStatus(s.percentage, s.target);
    return `<article class="subject-card"><div class="subject-head"><span class="subject-title"><span class="subject-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span><span class="subject-code">${escapeHtml(s.code)}</span></span><span class="percentage ${stat.className}">${s.percentage}%</span></div><div class="meter"><span style="width:${Math.min(s.percentage, 100)}%; background:${stat.color}"></span></div><div class="status-row"><span>${stat.label}${suffix ? ` ${suffix}` : ""}</span><span>${s.attended}/${s.conducted} classes</span></div><div class="status-row"><span>Safe buffer: ${s.safeBuffer} classes</span><span>${s.recovery}</span></div></article>`;
  }).join("");
}

// --- THE MATH ENGINE ---
function calculateSubjects(extraRecords = []) {
  const cls = appState.classes[appState.activeClassCode];
  if (!cls) return [];
  
  const activeWinKey = cls.settings.activeWindow || "semester";
  const win = cls.settings.windows[activeWinKey] || {};
  
  const start = win.start;
  const end = win.end;
  const target = win.target || 75;
  if (!start || !end) return [];

  // TIMELINE LOGIC
  const today = new Date().toISOString().split('T')[0];
  let effectiveEnd = end;
  
  const allRelevantRecords = [...(cls.manualRecords || []), ...extraRecords];
  if (today < end) {
    let maxRecordDate = today;
    allRelevantRecords.forEach(r => { if (r.date > maxRecordDate) maxRecordDate = r.date; });
    effectiveEnd = (maxRecordDate < end) ? maxRecordDate : end;
  }

  // 1. Create Time-Slot Map
  const timeSlotMap = new Map(); 
  const holidays = new Set(cls.settings.holidays || []);
  const specialDays = cls.settings.specialDays || {};
  
  let d = new Date(`${start}T00:00:00`);
  const e = new Date(`${effectiveEnd}T00:00:00`);
  
  while (d <= e) {
    const dateStr = d.toISOString().split('T')[0];
    if (!holidays.has(dateStr)) {
      let dayName = specialDays[dateStr] || d.toLocaleDateString('en-US', { weekday: 'long' });
      const daySchedule = cls.settings.timetable.find(t => t.day === dayName);
      if (daySchedule) {
        daySchedule.slots.forEach(slot => {
          if (slot.subject) timeSlotMap.set(`${dateStr}|${slot.hour}`, { subject: String(slot.subject).toUpperCase(), attended: true });
        });
      }
    }
    d.setDate(d.getDate() + 1);
  }

  // 2. OVERWRITE with Records (AND TRANSLATE TYPOS)
  const allRecords = [
    ...((appState.records || []).filter(r => r.classCode === appState.activeClassCode) || []),
    ...(cls.manualRecords || []),
    ...extraRecords
  ];
  
  const aliases = cls.settings.aliases || {};

  allRecords.forEach(r => {
    if (r.date >= start && r.date <= effectiveEnd) {
      let sCode = String(r.subject).toUpperCase();
      
      // THE TRANSLATION FIX: If the portal logged CS800T, but your CSV mapped CS800T -> CS800A, translate it!
      if (aliases[sCode]) sCode = aliases[sCode]; 

      const s = String(r.status || r.type || "Absent").toLowerCase();
      const isPresent = (s === 'present' || s.includes('duty') || s === 'od' || s === 'approved leave');
      
      timeSlotMap.set(`${r.date}|${r.hour}`, { subject: sCode, attended: isPresent });
    }
  });

  // 3. Tally Final Results
  const grouped = new Map();
  timeSlotMap.forEach((data, key) => {
    const { subject, attended } = data;
    
    // THE [object Object] FIX: Robust name resolution
    let catVal = cls.subjectCatalog[subject];
    let resolvedName = (typeof catVal === 'object' && catVal !== null) ? (catVal.name || subject) : (catVal || subject);

    if (!grouped.has(subject)) {
      grouped.set(subject, { code: subject, name: resolvedName, conducted: 0, attended: 0, target });
    }
    const sub = grouped.get(subject);
    sub.conducted += 1;
    sub.attended += attended ? 1 : 0;
  });

  // 4. Calculate Safe Buffers
  return [...grouped.values()].map(s => {
    const percentage = s.conducted ? Math.round((s.attended / s.conducted) * 100) : 100;
    let buffer = 0;
    if (percentage >= target) buffer = Math.floor(s.attended / (target / 100)) - s.conducted;
    let recovery = 0;
    if (percentage < target) recovery = Math.ceil(((target / 100) * s.conducted - s.attended) / (1 - (target / 100)));

    return { ...s, percentage, safeBuffer: buffer >= 0 ? buffer : 0, recovery: recovery > 0 ? `Attend next ${recovery} classes` : "On track" };
  }).sort((a, b) => a.percentage - b.percentage);
}


function generateLeaveRecords(start, end) {
  if (!start || !end) return [];
  const cls = appState.classes[appState.activeClassCode];
  const sim = [];
  const holidays = new Set(cls.settings.holidays || []);
  const specialDays = cls.settings.specialDays || {};
  
  let d = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  while (d <= e) {
    const dateStr = d.toISOString().split('T')[0];
    if (!holidays.has(dateStr)) {
      // Handle Saturday simulation
      let dayName = specialDays[dateStr] || d.toLocaleDateString('en-US', { weekday: 'long' });
      const daySchedule = cls.settings.timetable.find(t => t.day === dayName);
      if (daySchedule) {
        daySchedule.slots.forEach(slot => {
          if (slot.subject) sim.push({ date: dateStr, hour: slot.hour, subject: slot.subject, status: "Absent", source: "simulation" });
        });
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return sim;
}

function getRiskStatus(p, t) { if (p < t) return { label: "Shortage", className: "danger", color: "var(--danger)" }; if (p < t + 5) return { label: "Warning", className: "warning", color: "var(--warn)" }; return { label: "Safe", className: "safe", color: "var(--safe)" }; }
function escapeHtml(v) { return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
async function loadState() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(r[STORAGE_KEY] || { records: [], activeClassCode: "", classes: {} });
}
async function saveState(s) { await chrome.storage.local.set({ [STORAGE_KEY]: s }); }

function normalizeState(s = {}) {
  const state = { records: [], activeClassCode: "", classes: {}, ...s };
  state.records = state.records || [];
  state.classes = state.classes || {};
  Object.keys(state.classes).forEach((code) => {
    const cls = state.classes[code];
    cls.subjectCatalog = cls.subjectCatalog || {};
    cls.manualRecords = cls.manualRecords || [];
    cls.settings = normalizeSettings(cls.settings);
  });
  if (!state.activeClassCode) state.activeClassCode = Object.keys(state.classes)[0] || "";
  return state;
}

function normalizeSettings(settings = {}) {
  const defaults = createDefaultSettings();
  return {
    ...defaults,
    ...settings,
    windows: {
      ...defaults.windows,
      ...(settings.windows || {})
    },
    holidays: settings.holidays || [],
    specialDays: settings.specialDays || {},
    aliases: settings.aliases || {},
    timetable: settings.timetable || defaults.timetable
  };
}

function createDefaultSettings() {
  return {
    activeWindow: "semester",
    windows: {
      internal1: { start: "", end: "", target: 80 },
      internal2: { start: "", end: "", target: 80 },
      semester: { start: "", end: "", target: 75 }
    },
    holidays: [],
    specialDays: {},
    aliases: {},
    timetable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => ({
      day: d,
      slots: Array.from({ length: 7 }, (_, i) => ({ hour: i + 1, subject: "" }))
    }))
  };
}
