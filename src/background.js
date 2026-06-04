const STORAGE_KEY = "attendanceCopilot";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (result[STORAGE_KEY]) return;
    chrome.storage.local.set({ [STORAGE_KEY]: createDefaultState() });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  
  let classCode = res.classInfo?.classCode || appState.activeClassCode || "unknown";
  
  // THE GHOST CLASS FIX: If only syncing calendar holidays, force it into current profile
  if (res.records.length === 0 && Object.keys(res.subjectCatalog || {}).length === 0 && res.holidays?.length > 0) {
    if (appState.activeClassCode) classCode = appState.activeClassCode;
  }
  
  // Ensure the semester profile exists
  if (!appState.classes) appState.classes = {};
  if (!appState.classes[classCode]) {
    appState.classes[classCode] = { 
      classInfo: res.classInfo || { classCode }, 
      subjectCatalog: {}, 
      manualRecords: [],
      settings: createDefaultSettings() 
    };
  }
  
  appState.activeClassCode = classCode;
  const scannedRecords = res.records.map(r => ({ ...r, classCode }));
  
  // Merge Subjects
  appState.classes[classCode].subjectCatalog = { ...(appState.classes[classCode].subjectCatalog || {}), ...(res.subjectCatalog || {}) };
  
  // Merge Records (Idempotent wipe of old portal records, but KEEP manual overrides)
  if (scannedRecords.length) {
    const existing = appState.records || [];
    const preserved = existing.filter(r => !(r.classCode === classCode && (r.source === "rsms-leave-grid" || r.source === "portal")));
    
    // Deduplicate and merge (Manual 'preserved' records OVERWRITE portal 'scannedRecords')
    const map = new Map();
    [...scannedRecords, ...preserved].forEach(r => map.set([r.classCode, r.date, r.hour, r.subject].join("|"), r));
    appState.records = [...map.values()];
  }
  
  // Merge Holidays
  if (res.holidays?.length) {
    const existingHols = new Set(appState.classes[classCode].settings.holidays || []);
    res.holidays.forEach(h => existingHols.add(h));
    appState.classes[classCode].settings.holidays = Array.from(existingHols).sort();
  }
  
  // Update Sync Metadata (Totals)
  const totalSubjects = Object.keys(appState.classes[classCode].subjectCatalog || {}).length;
  const totalRecords = appState.records.filter(r => r.classCode === classCode).length;
  appState.classes[classCode].lastSync = { pageTitle: res.pageTitle, scannedAt: res.scannedAt, imported: totalRecords, subjects: totalSubjects };
  appState.lastSync = appState.classes[classCode].lastSync;
  
  await chrome.storage.local.set({ [STORAGE_KEY]: appState });
  
  if (res.records.length > 0) return `+${res.records.length} Records`;
  if (res.holidays?.length > 0) return `+${res.holidays.length} Holidays`;
  if (Object.keys(res.subjectCatalog||{}).length > 0) return `+Subjects`;
  return "Synced";
}

function createDefaultState() {
  return { records: [], subjectCatalog: {}, classInfo: null, activeClassCode: "", classes: {}, settings: createDefaultSettings() };
}

function createDefaultSettings() {
  return { activeWindow: "semester", windows: { internal1: { start: "", end: "", target: 80 }, internal2: { start: "", end: "", target: 80 }, semester: { start: "", end: "", target: 75 } }, holidays: [], specialDays: {}, timetable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => ({ day: d, slots: Array.from({ length: 7 }, (_, i) => ({ hour: i + 1, subject: "" })) })) };
}