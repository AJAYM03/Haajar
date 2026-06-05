const STORAGE_KEY = "attendanceCopilot";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (result[STORAGE_KEY]) return;
    chrome.storage.local.set({ [STORAGE_KEY]: createDefaultState() });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // SECURITY PATCH: Ignore messages not sent by our own extension
  if (sender.id !== chrome.runtime.id) return;

  if (message.type === "HAAJAR_BG_SYNC" && message.payload) {
    handleBackgroundSync(message.payload)
      .then(msg => sendResponse({ success: true, msg: msg }))
      .catch(err => sendResponse({ success: false, msg: "Error: " + err.message }));
    return true; 
  }
});

async function handleBackgroundSync(res) {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  let appState = raw[STORAGE_KEY] || createDefaultState();
  appState.records = appState.records || [];
  appState.classes = appState.classes || {};
  const records = res.records || [];
  
  let classCode = res.classInfo?.classCode || appState.activeClassCode || "unknown";
  
  // THE GHOST CLASS FIX: Force calendar syncs into current profile
  if (records.length === 0 && Object.keys(res.subjectCatalog || {}).length === 0 && res.holidays?.length > 0) {
    if (appState.activeClassCode) classCode = appState.activeClassCode;
  }
  
  if (!appState.classes[classCode]) {
    appState.classes[classCode] = { classInfo: res.classInfo || { classCode }, subjectCatalog: {}, manualRecords: [], settings: createDefaultSettings() };
  }
  appState.classes[classCode].settings = normalizeSettings(appState.classes[classCode].settings);
  
  appState.activeClassCode = classCode;
  const scannedRecords = records.map(r => ({ ...r, classCode }));
  appState.classes[classCode].subjectCatalog = { ...(appState.classes[classCode].subjectCatalog || {}), ...(res.subjectCatalog || {}) };
  
  // THE GHOST ABSENCE FIX: Overwrite if it's the Leave page, even if 0 records!
  if (scannedRecords.length > 0 || res.isLeavePage) {
    const existing = appState.records || [];
    const preserved = existing.filter(r => !(r.classCode === classCode && (r.source === "rsms-leave-grid" || r.source === "portal")));
    
    const map = new Map();
    [...scannedRecords, ...preserved].forEach(r => map.set([r.classCode, r.date, r.hour, r.subject].join("|"), r));
    appState.records = [...map.values()];
  }
  
  // --- HOLIDAY SYNC ---
  if (res.holidays?.length) {
    const existingHols = new Set(appState.classes[classCode].settings.holidays || []);
    res.holidays.forEach(h => existingHols.add(h));
    appState.classes[classCode].settings.holidays = Array.from(existingHols).sort();
  }

  // --- INTERNAL DATES SYNC (Respecting Manual Override) ---
  // --- INTERNAL DATES SYNC ---
  const win = appState.classes[classCode].settings.windows;
  
  const semesterNumber = getSemesterNumber(classCode, appState.classes[classCode].classInfo);
  const internal1 = filterInternalWindowBySemester(res.internalDates?.internal1 || res.int1 || {}, semesterNumber);
  const internal2 = filterInternalWindowBySemester(res.internalDates?.internal2 || res.int2 || {}, semesterNumber);
  if (shouldUpdateInternalWindow(win.internal1, internal1, internal2)) {
    win.internal1.start = internal1.start;
    win.internal1.end = internal1.end;
  }
  if (shouldUpdateInternalWindow(win.internal2, internal2, internal1)) {
    win.internal2.start = internal2.start;
    win.internal2.end = internal2.end;
  }
  
  const totalSubjects = Object.keys(appState.classes[classCode].subjectCatalog || {}).length;
  const totalRecords = appState.records.filter(r => r.classCode === classCode).length;
  appState.classes[classCode].lastSync = { pageTitle: res.pageTitle, scannedAt: res.scannedAt, imported: totalRecords, subjects: totalSubjects };
  appState.lastSync = appState.classes[classCode].lastSync;
  
  await chrome.storage.local.set({ [STORAGE_KEY]: appState });
  
  if (records.length > 0) return `+${records.length} Records`;
  if (res.holidays?.length > 0) return `+${res.holidays.length} Holidays`;
  if (Object.keys(res.subjectCatalog||{}).length > 0) return `+Subjects`;
  if (res.isLeavePage) return "Records Cleaned";
  return "Synced";
}

function createDefaultState() {
  return { records: [], subjectCatalog: {}, classInfo: null, activeClassCode: "", classes: {}, settings: createDefaultSettings() };
}

function createDefaultSettings() {
  return { activeWindow: "semester", windows: { internal1: { start: "", end: "", target: 80 }, internal2: { start: "", end: "", target: 80 }, semester: { start: "", end: "", target: 75 } }, holidays: [], specialDays: {}, timetable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => ({ day: d, slots: Array.from({ length: 7 }, (_, i) => ({ hour: i + 1, subject: "" })) })) };
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

function shouldUpdateInternalWindow(current = {}, next = {}, otherNext = {}) {
  if (!next.start || !next.end) return false;
  if (!current.start && !current.end) return true;

  const sameStartBadEnd = current.start === next.start && current.end !== next.end;
  const copiedFromOtherExam = current.start === otherNext.start && current.end === otherNext.end;
  return sameStartBadEnd || copiedFromOtherExam;
}

function filterInternalWindowBySemester(windowData = {}, semesterNumber = null) {
  const events = windowData.events || [];
  if (!events.length || !semesterNumber) return windowData;

  const matchingDates = events
    .filter((event) => !event.semesters?.length || event.semesters.includes(semesterNumber))
    .map((event) => event.date)
    .filter(Boolean)
    .sort();

  if (!matchingDates.length) return {};
  return {
    ...windowData,
    start: matchingDates[0],
    end: matchingDates[matchingDates.length - 1],
    events: events.filter((event) => matchingDates.includes(event.date))
  };
}

function getSemesterNumber(classCode, classInfo = null) {
  if (classInfo?.semesterNumber) return Number(classInfo.semesterNumber);
  const match = String(classCode || "").match(/\b20\d{2}S(\d+)/i);
  return match ? Number(match[1]) : null;
}
