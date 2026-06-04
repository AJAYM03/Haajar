async function processAndSaveUnifiedCSV(csvText) {
  const lines = csvText.split('\n');
  
  let activeClassCode = "Unknown-Semester"; // Fallback
  const aliases = {};
  const catalog = {};
  const timetableMap = {};
  
  // PASS 1: Extract the Engine Data (Class Code & Mappings)
  lines.forEach(line => {
    if (!line.trim()) return;
    const parts = line.split(',').map(p => p.trim());
    const rowType = parts[0].toUpperCase();
    
    // 1. Auto-Fill the Class Code!
    if (rowType === 'CLASSCODE' && parts.length >= 2) {
      activeClassCode = parts[1];
    }
    // 2. Build the Translation Dictionary
    else if (rowType === 'MAPPING' && parts.length >= 4) {
      const alias = parts[1];
      const realCode = parts[2];
      const realName = parts.slice(3).join(',').trim(); 
      
      aliases[alias] = realCode; // e.g., ELEC_1 -> CS803D
      
      // Ignore "FREE" so it doesn't clutter the dashboard
      if (realCode.toUpperCase() !== 'FREE') {
        catalog[realCode] = realName;
      }
    }
  });

  // PASS 2: Build the Timetable (Translating Aliases to Real Codes)
  lines.forEach(line => {
    if (!line.trim()) return;
    const parts = line.split(',').map(p => p.trim());
    const rowType = parts[0].toUpperCase();
    
    if (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].includes(rowType)) {
      const day = parts[0];
      const slots = [];
      
      for (let i = 1; i <= 7; i++) {
        let cellValue = parts[i] || "";
        
        // Translate the alias (ELEC_1 becomes CS803D)
        if (aliases[cellValue]) cellValue = aliases[cellValue];
        
        // Erase "FREE" slots so the math engine ignores them
        if (cellValue.toUpperCase() === 'FREE') cellValue = "";
        
        slots.push({ hour: i, subject: cellValue });
      }
      timetableMap[day] = slots;
    }
  });

  // PASS 3: Save Everything to the Database Instantly
  const raw = await chrome.storage.local.get("attendanceCopilot");
  let appState = raw.attendanceCopilot || { classes: {} }; 
  
  // Set this semester as the active one
  appState.activeClassCode = activeClassCode;
  
  // Ensure the database folder exists for this specific semester
  if (!appState.classes[activeClassCode]) {
    appState.classes[activeClassCode] = { 
      classInfo: { classCode: activeClassCode }, 
      subjectCatalog: {}, 
      settings: { timetable: [], windows: { semester: { start: "", end: "", target: 75 } } } 
    };
  }

  // Inject the mapped catalog and timetable
  appState.classes[activeClassCode].subjectCatalog = catalog;
  appState.classes[activeClassCode].settings.timetable = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => ({
    day: day,
    slots: timetableMap[day] || Array.from({ length: 7 }, (_, i) => ({ hour: i + 1, subject: "" }))
  }));

  await chrome.storage.local.set({ attendanceCopilot: appState });
  alert(`Setup Saved for ${activeClassCode}! You are ready to sync absences.`);
}