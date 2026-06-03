const STORAGE_KEY = "attendanceCopilot";
const POSITIVE_STATUSES = new Set(["present", "duty leave", "duty attendance", "approved leave", "on duty", "od"]);
const NEGATIVE_STATUSES = new Set(["absent", "leave"]);
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
}

function switchView(viewName) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === viewName));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("is-active", v.id === viewName));
}

async function syncFromPortal() {
  const button = document.getElementById("syncButton");
  if (button.disabled) return; // ANTI-SPAM LOCK
  
  button.disabled = true;
  button.textContent = "Syncing";
  setSyncStatus("Checking active tab...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active browser tab found.");
    if (/^(chrome|edge|brave|about):\/\//i.test(tab.url || "")) throw new Error("Open the RSMS page, then press Sync.");

    setSyncStatus("Injecting scanner...");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content.js"] });

    setSyncStatus("Reading portal...");
    const [scanResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.AttendanceCopilotScanner?.scan ? window.AttendanceCopilotScanner.scan() : { ok: false, error: "Scanner failed." }
    });

    const res = scanResult?.result;
    if (!res?.ok) throw new Error(res?.error || "Could not read page.");

    const classCode = res.classInfo?.classCode || "unknown";
    ensureClassProfile(classCode, res.classInfo);
    appState.activeClassCode = classCode;
    const scannedRecords = res.records.map(r => ({ ...r, classCode }));
    appState.classInfo = res.classInfo || appState.classes[classCode].classInfo || null;
    appState.classes[classCode].classInfo = appState.classInfo;
    appState.classes[classCode].subjectCatalog = { ...(appState.classes[classCode].subjectCatalog || {}), ...(res.subjectCatalog || {}) };
    
    if (scannedRecords.length) {
      appState.records = replacePortalRecordsForClass(appState.records, scannedRecords, classCode);
      applyWindowDefaultsFromScan(scannedRecords);
    }

    if (res.holidays?.length) {
      const existing = new Set(appState.classes[classCode].settings.holidays);
      res.holidays.forEach(h => existing.add(h));
      appState.classes[classCode].settings.holidays = Array.from(existing).sort();
    }
    
    // Calculate the TRUE totals for the active class after the merge
    const totalSubjects = Object.keys(appState.classes[classCode].subjectCatalog || {}).length;
    const totalRecords = appState.records.filter(r => r.classCode === classCode).length;
    
    const lastSync = { 
      pageTitle: res.pageTitle, 
      scannedAt: res.scannedAt, 
      imported: totalRecords, 
      subjects: totalSubjects, 
      classInfo: res.classInfo || null 
    };
    appState.lastSync = lastSync;
    appState.classes[classCode].lastSync = lastSync;
    
    await saveState(appState);
    render();
    setSyncStatus(syncSuccessMessage(res), "success");
  } catch (error) {
    setSyncStatus(toSyncErrorMessage(error), "error");
  } finally {
    button.disabled = false;
    button.textContent = "Sync";
  }
}

function setSyncStatus(msg, type = "") {
  const el = document.getElementById("syncStatus");
  el.textContent = msg || "";
  el.className = ["sync-status", msg ? "is-visible" : "", type ? `is-${type}` : ""].filter(Boolean).join(" ");
}

function toSyncErrorMessage(error) { return error?.message || String(error); }
function syncSuccessMessage(res) {
  const subj = Object.keys(res.subjectCatalog || {}).length;
  const hols = res.holidays?.length || 0;
  const label = res.classInfo?.label ? ` for ${res.classInfo.label}` : "";

  if (res.records.length && subj) return `Imported ${res.records.length} records and ${subj} subjects${label}.`;
  if (res.records.length) return `Imported ${res.records.length} records${label}.`;
  
  // ADDED: The Calendar Check
  if (hols > 0 && subj === 0 && res.records.length === 0) return `Synced ${hols} holidays from calendar.`;
  
  return `Synced ${subj} subjects${label}.`;
}

function simulateLeave(event) {
  event.preventDefault();
  const simRecs = generateLeaveRecords(document.getElementById("leaveStart").value, document.getElementById("leaveEnd").value);
  renderSubjectCards(document.getElementById("simulationResult"), calculateSubjects(simRecs), "after planned leave");
}

function render() {
  const active = getActiveWindow();
  renderClassContext();
  document.getElementById("activeWindowLabel").textContent = active.label;
  document.getElementById("targetLabel").textContent = `${active.target}%`;
  document.getElementById("recordCount").textContent = String(getCurrentClassRecords().length);
  const lastSync = getCurrentClassProfile()?.lastSync || appState.lastSync;
  document.getElementById("syncMeta").textContent = lastSync ? syncMetaText(lastSync) : "No portal sync yet";
  renderSubjectCards(document.getElementById("subjectList"), calculateSubjects());

  // ADD THESE THREE LINES: Lock the simulator to the current semester dates
  const simStart = document.getElementById("leaveStart");
  const simEnd = document.getElementById("leaveEnd");
  if (simStart && simEnd && active.start && active.end) {
    simStart.min = active.start; simStart.max = active.end;
    simEnd.min = active.start; simEnd.max = active.end;
  }
}

function renderClassContext() {
  const container = document.getElementById("classContext");
  const activeCode = getActiveClassCode();
  const info = getCurrentClassProfile()?.classInfo || appState.classInfo;
  if (!info?.classCode) return container.classList.remove("is-visible");
  
  container.classList.add("is-visible");
  container.innerHTML = `
    <label class="class-picker">Class / semester
      <select id="classPicker">
        ${Object.keys(appState.classes || {}).sort().map(c => `<option value="${escapeHtml(c)}" ${c === activeCode ? "selected" : ""}>${escapeHtml(appState.classes[c].classInfo?.label || c)}</option>`).join("")}
      </select>
    </label>
    <span>${escapeHtml(classSubtitle(info))}</span>`;
  document.getElementById("classPicker")?.addEventListener("change", (e) => {
    appState.activeClassCode = e.target.value;
    appState.classInfo = getCurrentClassProfile()?.classInfo || null;
    saveState(appState).then(render);
  });
}

function renderSubjectCards(container, subjects, suffix = "") {
  if (!subjects.length) {
    container.innerHTML = `
      <div class="panel empty" style="text-align: left;">
        <h3 style="color:var(--maroon); margin-bottom: 8px; margin-top: 0;">Setup Required</h3>
        <p style="font-size: 12px; margin-bottom: 10px; color: var(--muted);">New semester or fresh install? Follow these steps:</p>
        <ol style="margin:0; padding-left:18px; line-height:1.6; font-size: 12px;">
          <li>Sync your RSMS <strong>Marks</strong> page.</li>
          <li>Click the ⚙️ <strong>gear icon</strong> above.</li>
          <li>Paste your new Timetable CSV.</li>
          <li>Sync your <strong>Leave Details</strong> page.</li>
        </ol>
      </div>`;
    return;
  }
  container.innerHTML = subjects.map(s => {
    const stat = getRiskStatus(s.percentage, s.target);
    return `<article class="subject-card"><div class="subject-head"><span class="subject-title"><span class="subject-name" title="${escapeHtml(s.displayName)}">${escapeHtml(s.displayName)}</span><span class="subject-code">${escapeHtml(s.name)}${s.kind ? ` - ${escapeHtml(s.kind)}` : ""}</span></span><span class="percentage ${stat.className}">${s.percentage}%</span></div><div class="meter"><span style="width:${Math.min(s.percentage, 100)}%; background:${stat.color}"></span></div><div class="status-row"><span>${stat.label}${suffix ? ` ${suffix}` : ""}</span><span>${s.attended}/${s.conducted} classes</span></div><div class="status-row"><span>Safe buffer: ${s.safeBuffer} classes</span><span>${s.recovery}</span></div></article>`;
  }).join("");
}

function calculateSubjects(extraRecords = []) {
  const active = getActiveWindow();
  if (!active.start || !active.end) return [];
  
  // --- TIMELINE LOGIC ---
  const today = toIso(new Date());
  let effectiveEnd = active.end;
  
  if (extraRecords.length === 0 && today < active.end) {
    effectiveEnd = today;
  } else if (extraRecords.length > 0) {
    const maxSimDate = extraRecords.reduce((max, r) => r.date > max ? r.date : max, today);
    effectiveEnd = (maxSimDate < active.end) ? maxSimDate : active.end;
  }
  
  // 1. Generate the baseline timetable and grab synced records
  const occurrences = generateOccurrences(active.start, effectiveEnd);
  const records = mergeRecords(getCurrentClassRecords(), extraRecords);
  const recordMap = new Map(records.map(r => [recordKey(r), r]));
  const grouped = new Map();
  
  // 2. Process the baseline timetable
  occurrences.forEach(o => {
    const rKey = recordKey(o);
    if (!grouped.has(o.subject)) grouped.set(o.subject, { name: o.subject, conducted: 0, attended: 0, target: active.target });
    
    const sub = grouped.get(o.subject);
    
    // Check if the RSMS portal has a specific record for this normal class
    if (recordMap.has(rKey)) {
      const actualRecord = recordMap.get(rKey);
      sub.conducted += 1;
      sub.attended += isPositiveRecord(actualRecord) ? 1 : 0;
      actualRecord._processed = true; // Mark as handled
    } else {
      // No record means perfect attendance for this slot
      sub.conducted += 1;
      sub.attended += 1;
    }
  });
  
  // 3. THE FIX: The "Source of Truth" Sweep
  // Process any unexpected/extra classes recorded in RSMS that weren't on the timetable
  records.forEach(r => {
    if (r.date >= active.start && r.date <= effectiveEnd && !r._processed) {
      if (!grouped.has(r.subject)) grouped.set(r.subject, { name: r.subject, conducted: 0, attended: 0, target: active.target });
      const sub = grouped.get(r.subject);
      
      // Add the unexpected class to the total math
      sub.conducted += 1;
      sub.attended += isPositiveRecord(r) ? 1 : 0; 
    }
  });
  
  // 4. Return the calculated data
  return [...grouped.values()].map(s => ({ 
    ...s, 
    displayName: subjectDisplayName(s.name), 
    kind: subjectKind(s.name), 
    percentage: s.conducted ? Math.round((s.attended / s.conducted) * 100) : 100, 
    safeBuffer: calculateSafeBuffer(s.attended, s.conducted, s.target), 
    recovery: calculateRecovery(s.attended, s.conducted, s.target) 
  })).sort((a, b) => a.percentage - b.percentage || a.name.localeCompare(b.name));
}

function generateOccurrences(start, end) {
  const settings = getCurrentSettings();
  const classCode = getActiveClassCode();
  const holidays = new Set(settings.holidays || []);
  const specialDays = settings.specialDays || {};
  const occurrences = [];
  let cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);

  while (cursor <= last) {
    const date = toIso(cursor);
    if (!holidays.has(date)) {
      // THE SATURDAY SWAP LOGIC
      let targetDayName = specialDays[date];
      if (!targetDayName) targetDayName = Object.keys(DAY_INDEX).find(d => DAY_INDEX[d] === cursor.getDay());
      
      const day = settings.timetable.find(e => e.day === targetDayName);
      day?.slots.forEach(slot => {
        if (slot.subject) occurrences.push({ date, hour: slot.hour, subject: normalizeSubject(slot.subject), status: "Present", source: "generated", classCode });
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return occurrences;
}

function generateLeaveRecords(start, end) { return start && end ? generateOccurrences(start, end).map(o => ({ ...o, status: "Absent", source: "simulation" })) : []; }
function calculateSafeBuffer(a, c, t) { let b = 0; while (c + b + 1 > 0 && a / (c + b + 1) >= t / 100) b++; return b; }
function calculateRecovery(a, c, t) { if (!c || a / c >= t / 100) return "On track"; let n = 0; while ((a + n) / (c + n) < t / 100 && n < 200) n++; return `Attend next ${n} classes`; }
function getRiskStatus(p, t) { if (p < t) return { label: "Shortage", className: "danger", color: "var(--danger)" }; if (p < t + 5) return { label: "Warning", className: "warning", color: "var(--warn)" }; return { label: "Safe", className: "safe", color: "var(--safe)" }; }
function isPositiveRecord(r) { if (!r) return true; const s = normalizeStatus(r.status).toLowerCase(); if (NEGATIVE_STATUSES.has(s)) return false; return POSITIVE_STATUSES.has(s) || !s.includes("absent"); }
function getActiveWindow() { return getCurrentSettings().windows[getCurrentSettings().activeWindow]; }
function mergeRecords(ex, inc) { const m = new Map(); [...ex, ...inc].forEach(r => { if(r?.date && r?.subject) m.set(recordKey(r), { date: r.date, hour: r.hour ? Number(r.hour) : null, subject: normalizeSubject(r.subject), status: normalizeStatus(r.status), source: r.source || "unknown", classCode: r.classCode || getActiveClassCode() }); }); return [...m.values()]; }
function replacePortalRecordsForClass(ex, inc, cc) { const p = new Set(["rsms-leave-grid", "portal"]); const r = ex.filter(r => !(((r.classCode || "") === cc || (!r.classCode && cc === "unknown")) && p.has(r.source))); return mergeRecords(r, inc); }
function applyWindowDefaultsFromScan(recs) { const d = recs.map(r => r.date).filter(Boolean).sort(); if (!d.length) return; const s = getCurrentSettings(); const sem = s.windows.semester; if (!sem.start) sem.start = d[0]; if (!sem.end) sem.end = d[d.length - 1]; s.activeWindow = s.activeWindow || "semester"; }
function recordKey(r) { return [r.classCode || "", r.date, r.hour || "", normalizeSubject(r.subject).toLowerCase()].join("|"); }
function normalizeSubject(s) { const t = String(s || "").replace(/\s+/g, " ").trim(); const sc = [...t.matchAll(/\d+\/([A-Z]{2,}\d{3,}[A-Z0-9-]*)/gi)]; if (sc.length) return sc[sc.length - 1][1].toUpperCase(); const pc = [...t.matchAll(/\b([A-Z]{2,}\d{3,}[A-Z0-9-]*)\b/gi)]; if (pc.length) return pc[pc.length - 1][1].toUpperCase(); return t.replace(/^\d+\//, ""); }
function syncMetaText(l) { const c = []; if (l.imported) c.push(`${l.imported} records`); if (l.subjects) c.push(`${l.subjects} subjects`); return `${c.join(", ") || "Profile"} from portal`; }
function classSubtitle(i) { return i ? `${i.semester || "Semester unknown"}${i.program ? ` - ${i.program}${i.section ? `-${i.section}` : ""}` : ""}` : "Semester unknown"; }
function subjectDisplayName(c) { const s = getCurrentClassProfile()?.subjectCatalog?.[normalizeSubject(c)] || appState.subjectCatalog?.[normalizeSubject(c)]; return typeof s === "string" ? s : s?.name || c; }
function subjectKind(c) { const s = getCurrentClassProfile()?.subjectCatalog?.[normalizeSubject(c)] || appState.subjectCatalog?.[normalizeSubject(c)]; return typeof s === "object" && s?.kind ? s.kind : ""; }
function getActiveClassCode() { return appState.activeClassCode || appState.classInfo?.classCode || Object.keys(appState.classes || {})[0] || ""; }
function getCurrentClassProfile() { const c = getActiveClassCode(); if (!c) return null; ensureClassProfile(c, appState.classInfo?.classCode === c ? appState.classInfo : null); return appState.classes[c]; }
function getCurrentSettings() { return getCurrentClassProfile()?.settings || appState.settings; }
function getCurrentClassRecords() { const c = getActiveClassCode(); return c ? appState.records.filter(r => r.classCode === c) : appState.records; }
function ensureClassProfile(c, i = null) { if (!appState.classes) appState.classes = {}; if (!appState.classes[c]) appState.classes[c] = { classInfo: i || { classCode: c }, subjectCatalog: {}, settings: createDefaultSettings() }; if (i) appState.classes[c].classInfo = i; appState.classes[c].settings = normalizeSettings(appState.classes[c].settings); }
function normalizeStatus(s) { return String(s || "Absent").replace(/\s+/g, " ").trim(); }
function toIso(d) { return d.toISOString().slice(0, 10); }
function escapeHtml(v) { return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
async function loadState() { const r = await chrome.storage.local.get(STORAGE_KEY); return normalizeState(r[STORAGE_KEY] || { records: [], subjectCatalog: {}, classInfo: null, settings: createDefaultSettings() }); }
function normalizeState(s) { const n = { records: [], subjectCatalog: {}, classInfo: null, activeClassCode: "", classes: {}, settings: createDefaultSettings(), ...s }; n.subjectCatalog = normalizeSubjectCatalog({ ...(s?.settings?.subjectCatalog || {}), ...(s?.subjectCatalog || {}) }); n.settings = normalizeSettings(s?.settings); n.records = (s?.records || []).map(r => ({ ...r, classCode: r.classCode || s?.classInfo?.classCode || n.activeClassCode || "legacy" })); n.records.forEach(r => ensureClassProfileForState(n, r.classCode, r.classCode === s?.classInfo?.classCode ? s?.classInfo : null)); Object.keys(n.classes).forEach(c => { n.classes[c].settings = normalizeSettings(n.classes[c].settings); n.classes[c].subjectCatalog = normalizeSubjectCatalog(n.classes[c].subjectCatalog || {}); n.classes[c].classInfo = n.classes[c].classInfo || { classCode: c }; }); if (!n.activeClassCode) n.activeClassCode = s?.classInfo?.classCode || Object.keys(n.classes)[0] || ""; if (n.activeClassCode && n.classes[n.activeClassCode]) n.classInfo = n.classes[n.activeClassCode].classInfo; return n; }
function ensureClassProfileForState(s, c, i = null) { if (c && !s.classes[c]) s.classes[c] = { classInfo: i || { classCode: c }, subjectCatalog: {}, settings: cloneSettings(s.settings || createDefaultSettings()) }; }
function createDefaultSettings() { return { activeWindow: "semester", windows: { internal1: { label: "Int 1", start: "", end: "", target: 80 }, internal2: { label: "Int 2", start: "", end: "", target: 80 }, semester: { label: "Sem", start: "", end: "", target: 75 } }, holidays: [], specialDays: {}, timetable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => ({ day: d, slots: Array.from({ length: 7 }, (_, i) => ({ hour: i + 1, subject: "" })) })) }; }
function normalizeSettings(s = {}) { const d = createDefaultSettings(); return { ...d, ...s, windows: { ...d.windows, ...(s?.windows || {}) }, holidays: s?.holidays || [], specialDays: s?.specialDays || {}, timetable: s?.timetable || d.timetable }; }
function cloneSettings(s) { return JSON.parse(JSON.stringify(normalizeSettings(s))); }
function normalizeSubjectCatalog(c) { return Object.fromEntries(Object.entries(c || {}).map(([k, v]) => [normalizeSubject(k), typeof v === "string" ? { name: v, kind: /lab\b/i.test(v) ? "lab" : "theory" } : v])); }
async function saveState(s) { await chrome.storage.local.set({ [STORAGE_KEY]: s }); }