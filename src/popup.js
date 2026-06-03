const STORAGE_KEY = "attendanceCopilot";
const POSITIVE_STATUSES = new Set(["present", "duty leave", "duty attendance", "approved leave", "on duty", "od"]);
const NEGATIVE_STATUSES = new Set(["absent", "leave"]);
const DAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

let appState = null;

document.addEventListener("DOMContentLoaded", async () => {
  appState = await loadState();
  bindEvents();
  render();
});

function bindEvents() {


  document.getElementById("exportStateButton").addEventListener("click", () => {
    exportBackup();
  });
  document.getElementById("importStateFile").addEventListener("change", importBackup);
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  document.getElementById("syncButton").addEventListener("click", syncFromPortal);
  document.getElementById("settingsForm").addEventListener("submit", saveSettings);
  document.getElementById("leaveForm").addEventListener("submit", simulateLeave);
  document.getElementById("saveTimetableButton").addEventListener("click", saveTimetable);
  document.getElementById("importTimetableButton").addEventListener("click", importBulkTimetable);
  document.getElementById("addSubjectButton").addEventListener("click", addSubjectEverywhere);
  document.getElementById("importManualButton").addEventListener("click", importManualRecords);
  document.getElementById("clearRecordsButton").addEventListener("click", clearRecords);
  document.getElementById("activeWindow").addEventListener("change", (event) => {
    getCurrentSettings().activeWindow = event.target.value;
    renderSettings();
  });
}

function switchView(viewName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === viewName);
  });
}

async function syncFromPortal() {
  const button = document.getElementById("syncButton");
  button.disabled = true;
  button.textContent = "Syncing";
  setSyncStatus("Checking active tab...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active browser tab found.");
    if (/^(chrome|edge|brave|about):\/\//i.test(tab.url || "")) {
      throw new Error("Chrome blocks extensions from scanning browser settings pages. Open the RSMS page or the fixture page, then press Sync.");
    }

    setSyncStatus("Injecting scanner into this tab...");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content.js"]
    });

    setSyncStatus("Reading attendance grid...");
    const [scanResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (!window.AttendanceCopilotScanner?.scan) {
          return {
            ok: false,
            error: "Scanner did not initialize on this page. Reload the page and try Sync again."
          };
        }
        return window.AttendanceCopilotScanner.scan();
      }
    });

    const response = scanResult?.result;
    if (!response?.ok) throw new Error(response?.error || "Could not read attendance rows on this page.");

    const classCode = response.classInfo?.classCode || "unknown";
    ensureClassProfile(classCode, response.classInfo);
    appState.activeClassCode = classCode;
    const scannedRecords = response.records.map((record) => ({ ...record, classCode }));
    appState.classInfo = response.classInfo || appState.classes[classCode].classInfo || null;
    appState.classes[classCode].classInfo = appState.classInfo;
    appState.classes[classCode].subjectCatalog = {
      ...(appState.classes[classCode].subjectCatalog || {}),
      ...(response.subjectCatalog || {})
    };
    if (scannedRecords.length) {
      appState.records = replacePortalRecordsForClass(appState.records, scannedRecords, classCode);
      applyWindowDefaultsFromScan(scannedRecords);
    }
    const lastSync = {
      pageTitle: response.pageTitle,
      scannedAt: response.scannedAt,
      imported: response.records.length,
      subjects: Object.keys(response.subjectCatalog || {}).length,
      classInfo: response.classInfo || null
    };
    appState.lastSync = lastSync;
    appState.classes[classCode].lastSync = lastSync;
    await saveState(appState);
    render();
    setSyncStatus(syncSuccessMessage(response), "success");
  } catch (error) {
    setSyncStatus(toSyncErrorMessage(error), "error");
  } finally {
    button.disabled = false;
    button.textContent = "Sync";
  }
}

function setSyncStatus(message, type = "") {
  const element = document.getElementById("syncStatus");
  element.textContent = message || "";
  element.className = ["sync-status", message ? "is-visible" : "", type ? `is-${type}` : ""]
    .filter(Boolean)
    .join(" ");
}

function toSyncErrorMessage(error) {
  const message = error?.message || String(error);
  if (/Cannot access contents of url "file:/i.test(message) || /The extensions gallery cannot be scripted/i.test(message)) {
    return "Chrome blocked file access. Open extension details and enable 'Allow access to file URLs', then reload the fixture page.";
  }
  if (/Cannot access.*chrome:\/\//i.test(message)) {
    return "Chrome blocks extensions from scanning browser settings pages. Open the RSMS page or fixture page first.";
  }
  if (/missing host permission|Cannot access contents/i.test(message)) {
    return "Chrome blocked access to this page. Click the extension from the RSMS tab, or reload the page and try again.";
  }
  return message;
}

function syncSuccessMessage(response) {
  const subjectCount = Object.keys(response.subjectCatalog || {}).length;
  const label = response.classInfo?.label ? ` for ${response.classInfo.label}` : "";
  if (response.records.length && subjectCount) {
    return `Imported ${response.records.length} records and synced ${subjectCount} subjects${label}.`;
  }
  if (response.records.length) return `Imported ${response.records.length} records${label}.`;
  if (subjectCount) return `Synced ${subjectCount} subjects${label}.`;
  return `Synced class profile${label}.`;
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
  settings.holidays = document.getElementById("holidays").value
    .split(/\n|,/)
    .map((date) => date.trim())
    .filter(Boolean);

  saveState(appState).then(render);
}

function saveTimetable() {
  const settings = getCurrentSettings();
  const catalog = getCurrentClassProfile()?.subjectCatalog || {};
  const unmatched = [];
  const nextTimetable = settings.timetable.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => {
      const input = document.querySelector(`[data-day="${day.day}"][data-hour="${slot.hour}"]`);
      const subject = resolveSubjectInput(input.value, catalog);
      input.classList.toggle("is-unmatched", Boolean(input.value.trim()) && !subject);
      if (input.value.trim() && !subject) unmatched.push(`${day.day} hour ${slot.hour}: ${input.value.trim()}`);
      return { ...slot, subject };
    })
  }));

  if (unmatched.length) {
    setTimetableStatus(`Timetable has ${unmatched.length} unmatched subject entr${unmatched.length === 1 ? "y" : "ies"}. Sync subjects first or use exact RSMS codes.`, "error");
    return;
  }

  settings.timetable = nextTimetable;
  saveState(appState).then(() => {
    render();
    setTimetableStatus("Timetable saved with synced subject codes.", "success");
  });
}

function importBulkTimetable() {
  const input = document.getElementById("bulkTimetable");
  const rows = input.value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!rows.length) return;

  const settings = getCurrentSettings();
  const catalog = getCurrentClassProfile()?.subjectCatalog || {};
  const unmatched = [];
  rows.forEach((line) => {
    const parts = line.split(/,|\t|\|/).map((part) => part.trim());
    const dayName = normalizeDayName(parts.shift());
    const day = settings.timetable.find((entry) => entry.day === dayName);
    if (!day) return;

    day.slots = day.slots.map((slot, index) => ({
      ...slot,
      subject: resolveSubjectInput(parts[index] || "", catalog) || trackUnmatchedSubject(parts[index], day.day, slot.hour, unmatched)
    }));
  });

  if (unmatched.length) {
    setTimetableStatus(`Imported rows, but ${unmatched.length} slot${unmatched.length === 1 ? "" : "s"} need exact subject codes.`, "error");
  } else {
    setTimetableStatus("Timetable rows imported.", "success");
  }

  input.value = "";
  saveState(appState).then(render);
}

function addSubjectEverywhere() {
  const subject = normalizeSubject(prompt("Subject name or code"));
  if (!subject) return;

  const firstEmpty = [...document.querySelectorAll(".slot-input")].find((input) => !input.value.trim());
  if (firstEmpty) firstEmpty.value = subject;
}

function importManualRecords() {
  const rows = document.getElementById("manualRecords").value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, hour, subject, status] = line.split(",").map((part) => part.trim());
      return {
        date,
        hour: hour ? Number(hour) : null,
        subject: normalizeSubject(subject),
        status: normalizeStatus(status || "Absent"),
        source: "manual",
        classCode: getActiveClassCode()
      };
    })
    .filter((record) => record.date && record.subject);

  appState.records = mergeRecords(appState.records, rows);
  document.getElementById("manualRecords").value = "";
  saveState(appState).then(render);
}

function exportBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "attendance-copilot",
    version: 1,
    state: normalizeState(appState)
  };
  const dataStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-copilot-backup-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setBackupStatus("Backup exported.", "success");
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    const state = imported.state || imported;
    if (!isBackupState(state)) {
      throw new Error("This does not look like an Attendance Copilot backup.");
    }
    const normalized = normalizeState(state);
    appState = normalized;
    await saveState(appState);
    render();
    setBackupStatus("Backup imported.", "success");
  } catch (error) {
    setBackupStatus(error?.message || "Could not import backup.", "error");
  } finally {
    event.target.value = "";
  }
}

function clearRecords() {
  const classCode = getActiveClassCode();
  if (!confirm(`Clear all records for ${classCode || "the active class"}?`)) return;
  appState.records = appState.records.filter((record) => record.classCode !== classCode);
  appState.lastSync = null;
  if (appState.classes?.[classCode]) appState.classes[classCode].lastSync = null;
  saveState(appState).then(render);
}

function simulateLeave(event) {
  event.preventDefault();
  const start = document.getElementById("leaveStart").value;
  const end = document.getElementById("leaveEnd").value;
  const simulatedRecords = generateLeaveRecords(start, end);
  const result = calculateSubjects(simulatedRecords);
  renderSubjectCards(document.getElementById("simulationResult"), result, "after planned leave");
}

function render() {
  renderDashboard();
  renderSettings();
  renderTimetable();
}

function renderDashboard() {
  const active = getActiveWindow();
  const subjects = calculateSubjects();
  renderClassContext();

  document.getElementById("activeWindowLabel").textContent = active.label;
  document.getElementById("targetLabel").textContent = `${active.target}%`;
  document.getElementById("recordCount").textContent = String(getCurrentClassRecords().length);
  const lastSync = getCurrentClassProfile()?.lastSync || appState.lastSync;
  document.getElementById("syncMeta").textContent = lastSync
    ? syncMetaText(lastSync)
    : "No portal sync yet";

  renderSubjectCards(document.getElementById("subjectList"), subjects);
}

function renderClassContext() {
  const container = document.getElementById("classContext");
  const classCodes = Object.keys(appState.classes || {}).sort();
  const activeCode = getActiveClassCode();
  const info = getCurrentClassProfile()?.classInfo || appState.classInfo || appState.lastSync?.classInfo;
  if (!info?.classCode) {
    container.className = "class-context";
    container.innerHTML = "";
    return;
  }

  container.className = "class-context is-visible";
  container.innerHTML = `
    <label class="class-picker">
      Class / semester
      <select id="classPicker">
        ${classCodes.map((code) => {
          const profile = appState.classes[code];
          const label = profile.classInfo?.label || code;
          return `<option value="${escapeHtml(code)}" ${code === activeCode ? "selected" : ""}>${escapeHtml(label)}</option>`;
        }).join("")}
      </select>
    </label>
    <span>${escapeHtml(classSubtitle(info))}</span>
  `;
  document.getElementById("classPicker")?.addEventListener("change", (event) => {
    appState.activeClassCode = event.target.value;
    appState.classInfo = getCurrentClassProfile()?.classInfo || null;
    saveState(appState).then(render);
  });
}

function renderSettings() {
  const settings = getCurrentSettings();
  const activeKey = settings.activeWindow;
  const active = settings.windows[activeKey];

  document.getElementById("activeWindow").value = activeKey;
  document.getElementById("windowStart").value = active.start || "";
  document.getElementById("windowEnd").value = active.end || "";
  document.getElementById("windowTarget").value = active.target || "";
  document.getElementById("holidays").value = settings.holidays.join("\n");
}

function renderTimetable() {
  const settings = getCurrentSettings();
  const catalog = getCurrentClassProfile()?.subjectCatalog || {};
  
  // Generate options for the dropdown based on synced subjects
  const subjectOptions = Object.keys(catalog).map((code) => {
    const name = catalog[code].name || code;
    return `<option value="${escapeHtml(code)}">${escapeHtml(name)} (${escapeHtml(code)})</option>`;
  }).join("");

  const editor = document.getElementById("timetableEditor");
  editor.innerHTML = `
    <datalist id="scrapedSubjects">
      ${subjectOptions}
    </datalist>
    ${settings.timetable.map((day) => `
      <div class="day-row">
        <strong>${escapeHtml(day.day)}</strong>
        <div class="slots">
          ${day.slots.map((slot) => `
            <input
              class="slot-input"
              list="scrapedSubjects"
              data-day="${escapeHtml(day.day)}"
              data-hour="${slot.hour}"
              title="${escapeHtml(day.day)} hour ${slot.hour}"
              placeholder="${slot.hour}"
              value="${escapeHtml(slot.subject)}"
            >
          `).join("")}
        </div>
      </div>
    `).join("")}
  `;
}
function renderSubjectCards(container, subjects, suffix = "") {
  if (!subjects.length) {
    container.innerHTML = `
      <div class="panel empty" style="text-align: left; padding: 16px;">
        <h3 style="margin-top:0; color: var(--ink); margin-bottom: 10px;">Setup Checklist</h3>
        <ol style="padding-left: 20px; margin-bottom: 0; line-height: 1.6; color: var(--muted);">
          <li>Open your <strong>RSMS Marks/Internal Exam</strong> page.</li>
          <li>Click this extension and press <strong>Sync</strong> (captures subjects).</li>
          <li>Go to the <strong>Setup</strong> tab and paste your Timetable rows.</li>
          <li>Open your <strong>RSMS Leave Details</strong> page.</li>
          <li>Press <strong>Sync</strong> one last time.</li>
        </ol>
      </div>`;
    return;
  }
  
  container.innerHTML = subjects.map((subject) => {
    const status = getRiskStatus(subject.percentage, subject.target);
    return `
      <article class="subject-card">
        <div class="subject-head">
          <span class="subject-title">
            <span class="subject-name" title="${escapeHtml(subject.displayName)}">${escapeHtml(subject.displayName)}</span>
            <span class="subject-code">${escapeHtml(subject.name)}${subject.kind ? ` - ${escapeHtml(subject.kind)}` : ""}</span>
          </span>
          <span class="percentage ${status.className}">${subject.percentage}%</span>
        </div>
        <div class="meter"><span style="width:${Math.min(subject.percentage, 100)}%; background:${status.color}"></span></div>
        <div class="status-row">
          <span>${status.label}${suffix ? ` ${suffix}` : ""}</span>
          <span>${subject.attended}/${subject.conducted} classes</span>
        </div>
        <div class="status-row">
          <span>Safe buffer: ${subject.safeBuffer} classes</span>
          <span>${subject.recovery}</span>
        </div>
      </article>
    `;
  }).join("");
}

function calculateSubjects(extraRecords = []) {
  const active = getActiveWindow();
  if (!active.start || !active.end) return [];

  const occurrences = generateOccurrences(active.start, active.end);
  const savedRecords = getCurrentClassRecords();
  const records = mergeRecords(savedRecords, extraRecords);
  const recordMap = new Map(records.map((record) => [recordKey(record), record]));
  const grouped = new Map();

  occurrences.forEach((occurrence) => {
    if (!grouped.has(occurrence.subject)) {
      grouped.set(occurrence.subject, { name: occurrence.subject, conducted: 0, attended: 0, target: active.target });
    }

    const subject = grouped.get(occurrence.subject);
    const record = recordMap.get(recordKey(occurrence));
    subject.conducted += 1;
    subject.attended += isPositiveRecord(record) ? 1 : 0;
  });

  return [...grouped.values()]
    .map((subject) => {
      const percentage = subject.conducted ? Math.round((subject.attended / subject.conducted) * 100) : 100;
      return {
        ...subject,
        displayName: subjectDisplayName(subject.name),
        kind: subjectKind(subject.name),
        percentage,
        safeBuffer: calculateSafeBuffer(subject.attended, subject.conducted, subject.target),
        recovery: calculateRecovery(subject.attended, subject.conducted, subject.target)
      };
    })
    .sort((a, b) => a.percentage - b.percentage || a.name.localeCompare(b.name));
}

function generateOccurrences(start, end) {
  const settings = getCurrentSettings();
  const classCode = getActiveClassCode();
  const holidays = new Set(settings.holidays);
  const occurrences = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);

  while (cursor <= last) {
    const date = toIso(cursor);
    if (!holidays.has(date)) {
      const day = settings.timetable.find((entry) => DAY_INDEX[entry.day] === cursor.getDay());
      day?.slots.forEach((slot) => {
        if (slot.subject) {
          occurrences.push({
            date,
            hour: slot.hour,
            subject: normalizeSubject(slot.subject),
            status: "Present",
            source: "generated",
            classCode
          });
        }
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return occurrences;
}

function generateLeaveRecords(start, end) {
  if (!start || !end) return [];
  return generateOccurrences(start, end).map((occurrence) => ({
    ...occurrence,
    status: "Absent",
    source: "simulation"
  }));
}

function calculateSafeBuffer(attended, conducted, target) {
  const targetRatio = target / 100;
  let buffer = 0;
  while (conducted + buffer + 1 > 0 && attended / (conducted + buffer + 1) >= targetRatio) {
    buffer += 1;
  }
  return buffer;
}

function calculateRecovery(attended, conducted, target) {
  const targetRatio = target / 100;
  if (!conducted || attended / conducted >= targetRatio) return "On track";

  let needed = 0;
  while ((attended + needed) / (conducted + needed) < targetRatio && needed < 200) {
    needed += 1;
  }
  return `Attend next ${needed} classes`;
}

function getRiskStatus(percentage, target) {
  if (percentage < target) return { label: "Shortage", className: "danger", color: "var(--danger)" };
  if (percentage < target + 5) return { label: "Warning", className: "warning", color: "var(--warn)" };
  return { label: "Safe", className: "safe", color: "var(--safe)" };
}

function isPositiveRecord(record) {
  if (!record) return true;
  const status = normalizeStatus(record.status).toLowerCase();
  if (NEGATIVE_STATUSES.has(status)) return false;
  if (POSITIVE_STATUSES.has(status)) return true;
  return !status.includes("absent");
}

function getActiveWindow() {
  const settings = getCurrentSettings();
  return settings.windows[settings.activeWindow];
}

function mergeRecords(existing, incoming) {
  const map = new Map();
  [...existing, ...incoming].forEach((record) => {
    if (!record?.date || !record?.subject) return;
    map.set(recordKey(record), {
      date: record.date,
      hour: record.hour ? Number(record.hour) : null,
      subject: normalizeSubject(record.subject),
      status: normalizeStatus(record.status),
      source: record.source || "unknown",
      classCode: record.classCode || getActiveClassCode()
    });
  });
  return [...map.values()];
}

function resolveSubjectInput(input, catalog = {}) {
  const text = String(input || "").trim();
  if (!text) return "";

  const normalized = normalizeSubject(text);
  if (!Object.keys(catalog).length) return normalized;
  if (catalog[normalized]) return normalized;

  const lower = text.toLowerCase();
  const match = Object.entries(catalog).find(([code, subject]) => {
    const name = typeof subject === "string" ? subject : subject?.name;
    return code.toLowerCase() === lower || name?.toLowerCase() === lower;
  });

  return match ? match[0] : "";
}

function trackUnmatchedSubject(input, day, hour, unmatched) {
  const value = String(input || "").trim();
  if (value) unmatched.push(`${day} hour ${hour}: ${value}`);
  return value ? normalizeSubject(value) : "";
}

function replacePortalRecordsForClass(existing, incoming, classCode) {
  const portalSources = new Set(["rsms-leave-grid", "portal"]);
  const retained = existing.filter((record) => {
    const sameClass = (record.classCode || "") === classCode || (!record.classCode && classCode === "unknown");
    return !(sameClass && portalSources.has(record.source));
  });
  return mergeRecords(retained, incoming);
}

function applyWindowDefaultsFromScan(records) {
  const dates = records.map((record) => record.date).filter(Boolean).sort();
  if (!dates.length) return;

  const settings = getCurrentSettings();
  const semester = settings.windows.semester;
  if (!semester.start) semester.start = dates[0];
  if (!semester.end) semester.end = dates[dates.length - 1];
  settings.activeWindow = settings.activeWindow || "semester";
}

function recordKey(record) {
  return [
    record.classCode || "",
    record.date,
    record.hour || "",
    normalizeSubject(record.subject).toLowerCase()
  ].join("|");
}

function normalizeSubject(subject) {
  const text = String(subject || "")
    .replace(/\s+/g, " ")
    .trim();
  const slashCodes = [...text.matchAll(/\d+\/([A-Z]{2,}\d{3,}[A-Z0-9-]*)/gi)];
  if (slashCodes.length) return slashCodes[slashCodes.length - 1][1].toUpperCase();

  const plainCodes = [...text.matchAll(/\b([A-Z]{2,}\d{3,}[A-Z0-9-]*)\b/gi)];
  if (plainCodes.length) return plainCodes[plainCodes.length - 1][1].toUpperCase();

  return text.replace(/^\d+\//, "");
}

function normalizeDayName(day) {
  const value = String(day || "").trim().toLowerCase();
  if (!value) return "";
  return Object.keys(DAY_INDEX).find((name) => name.toLowerCase().startsWith(value.slice(0, 3))) || "";
}

function syncMetaText(lastSync) {
  const chunks = [];
  if (lastSync.imported) chunks.push(`${lastSync.imported} records`);
  if (lastSync.subjects) chunks.push(`${lastSync.subjects} subjects`);
  return `${chunks.join(", ") || "Profile"} from ${lastSync.pageTitle || "portal"}`;
}

function classSubtitle(info) {
  if (!info) return "Semester unknown";
  const program = info.program ? ` - ${info.program}${info.section ? `-${info.section}` : ""}` : "";
  return `${info.semester || "Semester unknown"}${program}`;
}

function subjectDisplayName(code) {
  const subject = getCurrentClassProfile()?.subjectCatalog?.[normalizeSubject(code)] ||
    appState.subjectCatalog?.[normalizeSubject(code)];
  if (typeof subject === "string") return subject;
  if (subject?.name) return subject.name;
  return code;
}

function subjectKind(code) {
  const subject = getCurrentClassProfile()?.subjectCatalog?.[normalizeSubject(code)] ||
    appState.subjectCatalog?.[normalizeSubject(code)];
  return typeof subject === "object" && subject?.kind ? subject.kind : "";
}

function getActiveClassCode() {
  return appState.activeClassCode || appState.classInfo?.classCode || Object.keys(appState.classes || {})[0] || "";
}

function getCurrentClassProfile() {
  const classCode = getActiveClassCode();
  if (!classCode) return null;
  ensureClassProfile(classCode, appState.classInfo?.classCode === classCode ? appState.classInfo : null);
  return appState.classes[classCode];
}

function getCurrentSettings() {
  const profile = getCurrentClassProfile();
  if (profile) return profile.settings;
  return appState.settings;
}

function getCurrentClassRecords() {
  const classCode = getActiveClassCode();
  if (!classCode) return appState.records;
  return appState.records.filter((record) => record.classCode === classCode);
}

function ensureClassProfile(classCode, classInfo = null) {
  if (!appState.classes) appState.classes = {};
  if (!appState.classes[classCode]) {
    appState.classes[classCode] = {
      classInfo: classInfo || { classCode },
      subjectCatalog: {},
      settings: createDefaultSettings()
    };
  }
  if (classInfo) appState.classes[classCode].classInfo = classInfo;
  appState.classes[classCode].settings = normalizeSettings(appState.classes[classCode].settings);
}

function normalizeStatus(status) {
  return String(status || "Absent").replace(/\s+/g, " ").trim();
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(result[STORAGE_KEY] || {
    records: [],
    subjectCatalog: {},
    classInfo: null,
    settings: createDefaultSettings()
  });
}

function normalizeState(state) {
  const defaults = {
    records: [],
    subjectCatalog: {},
    classInfo: null,
    activeClassCode: "",
    classes: {},
    settings: createDefaultSettings()
  };

  const normalized = {
    ...defaults,
    ...state,
    subjectCatalog: normalizeSubjectCatalog({
      ...(state?.settings?.subjectCatalog || {}),
      ...(state?.subjectCatalog || {})
    }),
    settings: normalizeSettings(state?.settings),
    classes: state?.classes || {},
    records: state?.records || []
  };

  normalized.records = normalized.records.map((record) => ({
    ...record,
    classCode: record.classCode || state?.classInfo?.classCode || normalized.activeClassCode || "legacy"
  }));

  normalized.records.forEach((record) => {
    ensureClassProfileForState(normalized, record.classCode, record.classCode === state?.classInfo?.classCode ? state?.classInfo : null);
  });

  Object.keys(normalized.classes).forEach((classCode) => {
    normalized.classes[classCode].settings = normalizeSettings(normalized.classes[classCode].settings);
    normalized.classes[classCode].subjectCatalog = normalizeSubjectCatalog(normalized.classes[classCode].subjectCatalog || {});
    normalized.classes[classCode].classInfo = normalized.classes[classCode].classInfo || { classCode };
  });

  if (!normalized.activeClassCode) {
    normalized.activeClassCode = state?.classInfo?.classCode || Object.keys(normalized.classes)[0] || "";
  }
  if (normalized.activeClassCode && normalized.classes[normalized.activeClassCode]) {
    normalized.classInfo = normalized.classes[normalized.activeClassCode].classInfo;
  }

  return normalized;
}

function ensureClassProfileForState(state, classCode, classInfo = null) {
  if (!classCode) return;
  if (!state.classes[classCode]) {
    state.classes[classCode] = {
      classInfo: classInfo || { classCode },
      subjectCatalog: {},
      settings: cloneSettings(state.settings || createDefaultSettings())
    };
  }
}

function createDefaultSettings() {
  return {
    activeWindow: "semester",
    windows: {
      internal1: { label: "Internal 1", start: "", end: "", target: 80 },
      internal2: { label: "Internal 2", start: "", end: "", target: 80 },
      semester: { label: "Semester", start: "", end: "", target: 75 }
    },
    holidays: [],
    timetable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => ({
      day,
      slots: Array.from({ length: 7 }, (_, index) => ({ hour: index + 1, subject: "" }))
    }))
  };
}

function normalizeSettings(settings = {}) {
  const defaults = createDefaultSettings();
  return {
    ...defaults,
    ...settings,
    windows: {
      ...defaults.windows,
      ...(settings?.windows || {})
    },
    holidays: settings?.holidays || [],
    timetable: settings?.timetable || defaults.timetable
  };
}

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(normalizeSettings(settings)));
}

function normalizeSubjectCatalog(catalog) {
  return Object.fromEntries(
    Object.entries(catalog || {}).map(([code, value]) => [
      normalizeSubject(code),
      typeof value === "string"
        ? { name: value, kind: /lab\b/i.test(value) ? "lab" : "theory" }
        : value
    ])
  );
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function setBackupStatus(message, type = "") {
  const element = document.getElementById("backupStatus");
  if (!element) return;
  element.textContent = message || "";
  element.className = ["inline-status", message ? "is-visible" : "", type ? `is-${type}` : ""]
    .filter(Boolean)
    .join(" ");
}

function setTimetableStatus(message, type = "") {
  const element = document.getElementById("timetableStatus");
  if (!element) return;
  element.textContent = message || "";
  element.className = ["inline-status", message ? "is-visible" : "", type ? `is-${type}` : ""]
    .filter(Boolean)
    .join(" ");
}

function isBackupState(state) {
  return Boolean(state && typeof state === "object" && (
    Array.isArray(state.records) ||
    state.settings ||
    state.classes ||
    state.subjectCatalog ||
    state.classInfo
  ));
}
