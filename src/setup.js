const STORAGE_KEY = "attendanceCopilot";

let appState = null;

document.addEventListener("DOMContentLoaded", async () => {
  appState = await loadState();
  bindEvents();
  render();
});

function bindEvents() {
  document.getElementById("importBtn").addEventListener("click", importCSV);
  document.getElementById("saveDatesBtn").addEventListener("click", saveDates);
  document.getElementById("saveManualBtn").addEventListener("click", saveManualRecords);
  document.getElementById("exportStateBtn").addEventListener("click", exportState);
  document.getElementById("clearDataBtn").addEventListener("click", nukeData);
  
  const importFileInput = document.getElementById("importStateFile");
  document.getElementById("importStateBtn").addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", importState);
}

function render() {
  const classCodes = Object.keys(appState.classes || {}).sort();
  const container = document.getElementById("classContextContainer");
  const setupSection = document.getElementById("setup");

  if (!classCodes.length) {
    container.innerHTML = `<span style="color: rgba(255, 255, 255, 0.8); font-size: 13px;">No class active. Please paste a Master CSV below.</span>`;
  } else {
    container.innerHTML = `
      <div style="color: rgba(255, 255, 255, 0.9); font-size: 13px; display: flex; align-items: center; gap: 8px;">
        <span>Active Profile:</span>
        <select id="setupClassPicker" style="width: auto; padding: 4px 8px; font-size: 12px; background: rgba(0, 0, 0, 0.2); color: white; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; cursor: pointer;">
          ${classCodes.map(c => `<option value="${escapeHtml(c)}" ${c === appState.activeClassCode ? "selected" : ""} style="color: #000;">${escapeHtml(c)}</option>`).join("")}
        </select>
      </div>
    `;
    document.getElementById("setupClassPicker")?.addEventListener("change", (e) => {
      appState.activeClassCode = e.target.value;
      saveState(appState).then(render);
    });
  }

  const cls = appState.classes[appState.activeClassCode] || { settings: { windows: { semester: {} } }, manualRecords: [] };
  
  // Load Dates
  document.getElementById('startDate').value = cls.settings.windows.semester.start || "";
  document.getElementById('endDate').value = cls.settings.windows.semester.end || "";
  
  // Load Manual Records
  const manualText = (cls.manualRecords || []).map(r => `${r.date}, ${r.hour}, ${r.subject}, ${r.type}`).join('\n');
  document.getElementById('manualRecords').value = manualText;
}

async function importCSV() {
  const csvText = document.getElementById("csvText").value;
  if (!csvText.trim()) return alert("Please paste the CSV text first.");
  
  let activeCode = "Unknown-Semester";
  const aliases = {}, catalog = {}, timetableMap = {};
  const holidays = [], specialDays = {}; // Added Holiday/Special Arrays
  
  // PASS 1: Extract data
  csvText.split('\n').forEach(line => {
    if (!line.trim()) return;
    const parts = line.split(',').map(p => p.trim());
    const type = parts[0].toUpperCase();
    
    if (type === 'CLASSCODE' && parts.length >= 2) activeCode = parts[1];
    else if (type === 'MAPPING' && parts.length >= 4) {
      aliases[parts[1]] = parts[2].toUpperCase();
      if (parts[2].toUpperCase() !== 'FREE') catalog[parts[2].toUpperCase()] = parts.slice(3).join(',').trim();
    }
    // Added Zero-Friction Holiday/Saturday Routing
    else if (type === 'HOLIDAY' && parts.length >= 2) holidays.push(parts[1]);
    else if (type === 'SPECIAL' && parts.length >= 3) specialDays[parts[1]] = parts[2];
  });

  // PASS 2: Build Grid
  csvText.split('\n').forEach(line => {
    if (!line.trim()) return;
    const parts = line.split(',').map(p => p.trim());
    const type = parts[0].toUpperCase();
    
    if (['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY'].includes(type)) {
      const slots = [];
      for (let i = 1; i <= 7; i++) {
        let val = parts[i] || "";
        if (aliases[val]) val = aliases[val];
        if (val.toUpperCase() === 'FREE') val = "";
        slots.push({ hour: i, subject: val.toUpperCase() }); // Enforce Uppercase
      }
      timetableMap[parts[0]] = slots;
    }
  });

  appState.activeClassCode = activeCode;
  if (!appState.classes[activeCode]) {
    appState.classes[activeCode] = { classInfo: { classCode: activeCode }, records: [], manualRecords: [], settings: { windows: { semester: { target: 75 } }, holidays: [], specialDays: {} } };
  }
  
  appState.classes[activeCode].subjectCatalog = catalog;
  appState.classes[activeCode].settings.holidays = holidays;
  appState.classes[activeCode].settings.specialDays = specialDays;
  appState.classes[activeCode].settings.timetable = ['Monday','Tuesday','Wednesday','Thursday','Friday'].map(day => ({
    day, slots: timetableMap[day] || Array.from({length:7}, (_,i)=>({hour:i+1, subject:""}))
  }));

  await saveState(appState);
  document.getElementById("csvText").value = "";
  alert(`Setup Saved for ${activeCode}!`);
  render();
}

async function saveDates() {
  if (!appState.activeClassCode || !appState.classes[appState.activeClassCode]) return alert("Import a CSV first!");
  appState.classes[appState.activeClassCode].settings.windows.semester.start = document.getElementById("startDate").value;
  appState.classes[appState.activeClassCode].settings.windows.semester.end = document.getElementById("endDate").value;
  await saveState(appState);
  alert("Dates Saved!");
}

async function saveManualRecords() {
  if (!appState.activeClassCode || !appState.classes[appState.activeClassCode]) return alert("Import a CSV first!");
  const lines = document.getElementById("manualRecords").value.split('\n');
  const records = [];
  lines.forEach(l => {
    const p = l.split(',').map(x => x.trim());
    // Enforce Uppercase on subject injection to prevent duplicates
    if(p.length >= 4) records.push({ date: p[0], hour: parseInt(p[1]), subject: p[2].toUpperCase(), type: p[3] });
  });
  appState.classes[appState.activeClassCode].manualRecords = records;
  await saveState(appState);
  alert("Manual Records Injected!");
}

async function nukeData() {
  const code = appState.activeClassCode;
  if (!code) return;
  if(confirm(`Completely delete ALL data for ${code}?`)) {
    appState.records = appState.records.filter(r => r.classCode !== code);
    delete appState.classes[code];
    appState.activeClassCode = Object.keys(appState.classes)[0] || "";
    await saveState(appState);
    alert("Nuked. Refreshing.");
    render();
  }
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

// Helpers
function escapeHtml(v) { return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
async function loadState() { const r = await chrome.storage.local.get(STORAGE_KEY); return normalizeState(r[STORAGE_KEY] || { records: [], subjectCatalog: {}, classInfo: null, settings: createDefaultSettings() }); }
function normalizeState(s) { const n = { records: [], subjectCatalog: {}, classInfo: null, activeClassCode: "", classes: {}, settings: createDefaultSettings(), ...s }; n.records = (s?.records || []).map(r => ({ ...r, classCode: r.classCode || s?.classInfo?.classCode || n.activeClassCode || "legacy" })); if (!n.activeClassCode) n.activeClassCode = s?.classInfo?.classCode || Object.keys(n.classes)[0] || ""; return n; }
function createDefaultSettings() { return { activeWindow: "semester", windows: { semester: { start: "", end: "", target: 75 } }, holidays: [], specialDays: {}, timetable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => ({ day: d, slots: Array.from({ length: 7 }, (_, i) => ({ hour: i + 1, subject: "" })) })) }; }
async function saveState(s) { await chrome.storage.local.set({ [STORAGE_KEY]: s }); }