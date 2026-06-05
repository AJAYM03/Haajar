(() => {
  if (window.__attendanceCopilotContentLoaded && window.AttendanceCopilotScanner) return;
  window.__attendanceCopilotContentLoaded = true;

  const DATE_PATTERNS = [/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/, /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/, /\b\d{1,2}[-\s]+[A-Za-z]{3,9}[-\s]+\d{2,4}\b/, /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\b/];
  const STATUS_WORDS = ["absent", "leave", "approved leave", "duty leave", "duty attendance", "present", "od", "on duty"];
  const RSMS_STATUS_BY_COLOR = { leave: "Leave", approvedLeave: "Approved Leave", dutyLeave: "Duty Leave", dutyAttendance: "Duty Attendance" };
  const SUBJECT_CODE_PATTERN = /\b(?:\d+\/)?[A-Z]{2,}\d{3,}[A-Z0-9-]*\b/i;

  window.AttendanceCopilotScanner = {
    scan: () => {
      try {
        const classInfo = getSelectedClassInfo();
        const calendarData = scanCalendar();
        return {
          ok: true,
          records: scanAttendanceRecords(),
          classInfo,
          subjectCatalog: scanSubjectCatalog(),
          holidays: calendarData.holidays || [],
          internalDates: calendarData.internalDates || {
            internal1: calendarData.int1,
            internal2: calendarData.int2
          },
          pageTitle: document.title,
          isLeavePage: /leave details/i.test(document.body?.innerText || "") || /leave/i.test(document.title),
          scannedAt: new Date().toISOString()
        };
      } catch (error) { return { ok: false, error: error.message }; }
    }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "ATTENDANCE_COPILOT_SCAN") return;
    sendResponse(window.AttendanceCopilotScanner.scan());
    return true;
  });

  function scanCalendar() {
    // Notice it now returns an empty object {} instead of an array [] if it fails
    if (!/calendar/i.test(document.title) && !/calendar/i.test(document.body.innerText)) return {}; 
    
    const holidays = [];
    const internalDates = { int1: [], int2: [] }; // Collect all dates for exam blocks

    const headers = [...document.querySelectorAll("th, td, div")].filter(el => /^[A-Za-z]+\s+\d{4}$/.test(el.innerText.trim()));
    if (!headers.length) return {};
    
    const monthYearStr = headers[0].innerText.trim();
    const parsedDate = new Date(`${monthYearStr} 01`);
    if (isNaN(parsedDate)) return {};
    
    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');

    [...document.querySelectorAll("td")].forEach(cell => {
      const text = cell.innerText.trim();
      const numMatch = text.match(/^(\d{1,2})/);
      if (!numMatch) return;
      const currentDateIso = `${year}-${month}-${String(numMatch[1]).padStart(2, '0')}`;
      const eventText = text
        .replace(/^\d{1,2}\b/, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const isMinorHonoursInternal = /\b(minor|honours?|honors?)\b/.test(eventText) && /\binternal\b/.test(eventText);

      // 1. Holiday Check
      const isRed = cell.querySelector('font[color="#FF0000"], font[color="#CC0000"], font[color="red"]');
      if (isRed && !isMinorHonoursInternal) holidays.push(currentDateIso);

      // 2. Internal Exam Streak Detection
      if (isMinorHonoursInternal) return;
      if (isMainInternalExam(eventText, 1)) {
         internalDates.int1.push({
           date: currentDateIso,
           semesters: parseSemesterTags(eventText)
         });
      }
      if (isMainInternalExam(eventText, 2)) {
         internalDates.int2.push({
           date: currentDateIso,
           semesters: parseSemesterTags(eventText)
         });
      }
    });
    
    // Convert arrays to min/max range
    const getRange = (arr) => {
      const dates = arr.map((event) => event.date || event).filter(Boolean).sort();
      return dates.length ? ({ start: dates[0], end: dates[dates.length - 1] }) : ({ start: null, end: null });
    };
    
    return {
        holidays,
        int1: getRange(internalDates.int1),
        int2: getRange(internalDates.int2),
        internalDates: {
          internal1: { ...getRange(internalDates.int1), events: internalDates.int1 },
          internal2: { ...getRange(internalDates.int2), events: internalDates.int2 }
        }
    };
  }

  function isMainInternalExam(text, number) {
    const examPattern = new RegExp(`\\binternal\\s+examinations?\\s*-\\s*${number}\\b`);
    const compactPattern = new RegExp(`\\binternal\\s*-\\s*${number}\\b`);
    return examPattern.test(text) || compactPattern.test(text);
  }

  function parseSemesterTags(text) {
    return [...text.matchAll(/\bs\s*(\d+)\b/gi)]
      .map((match) => Number(match[1]))
      .filter(Boolean);
  }

  function scanAttendanceRecords() {
    const rsmsRecords = scanRsmsLeaveGrid();
    if (rsmsRecords.length) return dedupeRecords(rsmsRecords);
    if (isLikelyRsmsPage()) return [];

    const rows = [...document.querySelectorAll("table tr")];
    const tableRecords = rows.flatMap(parseTableRow).filter(Boolean);
    if (tableRecords.length) return dedupeRecords(tableRecords);

    return dedupeRecords(parsePlainText(document.body.innerText || ""));
  }

  function getSelectedClassInfo() {
    const select = [...document.querySelectorAll("select")].find((element) => [...element.options].some((option) => parseClassCode(option.value) || parseClassCode(option.textContent)));
    const rawCode = cleanText(select?.selectedOptions?.[0]?.value || select?.value || select?.selectedOptions?.[0]?.textContent || "");
    const classCode = parseClassCode(rawCode) || parseClassCode(document.body?.innerText || "");
    return classCode ? describeClassCode(classCode) : null;
  }

  function parseClassCode(value) {
    const match = String(value || "").match(/\b(20\d{2}S\d+[A-Z]{2,}(?:-[A-Z0-9]+)?)\b/i);
    return match ? match[1].toUpperCase() : null;
  }

  function describeClassCode(classCode) {
    const match = classCode.match(/^(20\d{2})S(\d+)([A-Z]{2,})(?:-([A-Z0-9]+))?$/i);
    if (!match) return { classCode };
    return { classCode, batchYear: match[1], semesterNumber: Number(match[2]), semester: `Semester ${match[2]}`, program: match[3], section: match[4] || "", label: `${classCode} - Semester ${match[2]} - ${match[3]}${match[4] ? `-${match[4]}` : ""}` };
  }

  function scanSubjectCatalog() {
    // THE FIX: The Leave page only has codes, no names. 
    // If we scrape here, we accidentally grab layout elements like the dropdown menu.
    const isLeavePage = /leave details/i.test(document.body?.innerText || "") || /leave/i.test(document.title);
    if (isLeavePage) return {};

    const catalog = {};
    [...document.querySelectorAll("tr")].forEach((row) => {
      // Prevent nested wrapper tables from merging text
      if (row.closest('table').querySelectorAll('table').length > 0) return; 
      
      const entry = parseSubjectCatalogRow(row);
      if (entry) catalog[entry.code] = entry;
    });
    return catalog;
  }

  function parseSubjectCatalogRow(row) {
    const cells = getCells(row).map(c => cleanText(c.innerText)).filter(Boolean);
    if (cells.length < 2) return null;
    if (/\b(code|subject|sl\s*no|roll\s*no|name)\b/.test(cells.join(" ").toLowerCase()) && !cells.some((c) => SUBJECT_CODE_PATTERN.test(c))) return null;
    const codeIndex = cells.findIndex(c => SUBJECT_CODE_PATTERN.test(c));
    if (codeIndex === -1) return null;
    const code = normalizeSubject(cells[codeIndex]);
    const name = cells.slice(codeIndex + 1).find(c => c.length > 2 && !SUBJECT_CODE_PATTERN.test(c) && !/^\d+$/.test(c) && !/^[A-Z0-9/-]+$/.test(c));
    if (!code || !name) return null;
    return { code, name, kind: /lab\b/i.test(name) ? "lab" : "theory" };
  }

  function isLikelyRsmsPage() {
    const pt = cleanText(document.body?.innerText || "").toLowerCase();
    return pt.includes("rajagiri students") || pt.includes("leave details") || pt.includes("r.s.m.s") || pt.includes("rsms");
  }

  function scanRsmsLeaveGrid() {
    for (const table of document.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      if (!looksLikeRsmsLeaveTable(rows)) continue;
      const headerIndex = findRsmsHeaderIndex(rows);
      const hourByColumn = buildRsmsHourMap(rows[headerIndex]);
      const records = (headerIndex === -1 ? rows : rows.slice(headerIndex + 1)).flatMap(r => parseRsmsLeaveRow(r, hourByColumn));
      if (records.length) return records;
    }
    return [];
  }

  function looksLikeRsmsLeaveTable(rows) { return rows.filter(r => getCells(r).some(c => findDate([c.innerText]))).some(r => getCells(r).some(c => SUBJECT_CODE_PATTERN.test(cleanText(c.innerText)))); }
  function findRsmsHeaderIndex(rows) { return rows.findIndex(r => { const cells = getCells(r).map(c => cleanText(c.innerText).toLowerCase()); return cells.filter(t => /^[1-7]$/.test(t)).length >= 3 || (cells.some(t => /date\s*\/?\s*hours?/.test(t)) && cells.filter(t => /^[1-7]$/.test(t)).length >= 1); }); }
  function buildRsmsHourMap(headerRow) {
    if (!headerRow) return [null, 1, 2, 3, 4, 5, 6, 7];
    const hourByColumn = [];
    getCells(headerRow).forEach(c => { const t = cleanText(c.innerText); const h = /^[1-7]$/.test(t) ? Number(t) : null; const span = Number(c.getAttribute("colspan") || 1); for (let i = 0; i < span; i++) hourByColumn.push(h); });
    return hourByColumn.some(Boolean) ? hourByColumn : [null, 1, 2, 3, 4, 5, 6, 7];
  }

  function parseRsmsLeaveRow(row, hourByColumn) {
    const cells = getCells(row);
    const dateIdx = cells.findIndex(c => findDate([c.innerText]));
    if (dateIdx === -1) return [];
    const date = findDate([cells[dateIdx].innerText]);
    if (!date) return [];
    const records = [];
    let logicalCol = 0;
    cells.forEach((cell, idx) => {
      const span = Number(cell.getAttribute("colspan") || 1);
      if (idx <= dateIdx) { logicalCol += span; return; }
      const subject = normalizeSubject(cleanText(cell.innerText));
      const status = statusFromCellColor(cell);
      if (subject && status) {
        for (let off = 0; off < span; off++) {
          const hour = hourByColumn[logicalCol + off];
          if (hour) records.push({ date, hour, subject, status, source: "rsms-leave-grid" });
        }
      }
      logicalCol += span;
    });
    return records;
  }

  function statusFromCellColor(cell) {
    const color = effectiveBackgroundColor(cell);
    if (!color) return null;
    const rgb = parseRgb(color);
    if (!rgb) return null;
    const { r, g, b } = rgb;
    if (r > 120 && g < 80 && b < 80) return RSMS_STATUS_BY_COLOR.leave;
    if (g > 80 && r < 80 && b < 80) return RSMS_STATUS_BY_COLOR.approvedLeave;
    if (r > 180 && g >= 80 && g < 180 && b < 90) return RSMS_STATUS_BY_COLOR.dutyLeave;
    if (r >= 150 && g >= 150 && b < 100) return RSMS_STATUS_BY_COLOR.dutyAttendance;
    return null;
  }

  function effectiveBackgroundColor(element) {
    let current = element;
    while (current && current !== document.documentElement) {
      if (current.getAttribute?.("bgcolor")) return current.getAttribute("bgcolor");
      if (current.style?.backgroundColor || current.style?.background) return current.style.backgroundColor || current.style.background;
      const comp = getComputedStyle(current).backgroundColor;
      if (comp && comp !== "transparent" && !comp.endsWith(", 0)")) return comp;
      current = current.parentElement;
    }
    return null;
  }

  function parseRgb(color) {
    const named = { red: {r:255,g:0,b:0}, maroon: {r:128,g:0,b:0}, green: {r:0,g:128,b:0}, orange: {r:255,g:165,b:0}, yellow: {r:255,g:255,b:0} };
    const norm = cleanText(color).toLowerCase().replace(/\s+/g, "");
    if (named[norm]) return named[norm];
    const hex = norm.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) { const v = hex[1].length === 3 ? hex[1].split("").map(c => c+c).join("") : hex[1]; return { r: parseInt(v.slice(0,2),16), g: parseInt(v.slice(2,4),16), b: parseInt(v.slice(4,6),16) }; }
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) } : null;
  }

  function getCells(row) { return [...row.querySelectorAll("th,td")]; }

  function parseTableRow(row) {
    const cells = getCells(row).map(c => cleanText(c.innerText));
    if (cells.length < 3) return [];
    const joined = cells.join(" ");
    if (!DATE_PATTERNS.some(p => p.test(joined)) || !STATUS_WORDS.some(w => joined.toLowerCase().includes(w))) return [];
    const date = findDate(cells), hour = findHour(cells), status = findStatus(cells), subject = findSubject(cells, date, hour, status);
    return (date && subject && status) ? [{ date, hour, subject, status, source: "portal" }] : [];
  }

  function parsePlainText(text) {
    return text.split(/\n+/).map(cleanText).filter(Boolean).flatMap(line => {
      const date = findDate([line]), status = findStatus([line]);
      if (!date || !status) return [];
      const chunks = line.replace(date.raw, " ").replace(status.raw, " ").split(/\s{2,}|\t+/).map(cleanText).filter(Boolean);
      const hour = findHour(chunks), subject = findSubject(chunks, date, hour, status);
      return subject ? [{ date, hour, subject, status, source: "portal" }] : [];
    });
  }

  function findDate(values) { for (const v of values) { for (const p of DATE_PATTERNS) { const m = v.match(p); if (m) return { raw: m[0], iso: toIsoDate(m[0]) }; } } return null; }
  function findHour(values) { for (const v of values) { const m = v.match(/\b(?:hour|period|hr)?\s*([1-7])\b/i); if (m) return Number(m[1]); } return null; }
  function findStatus(values) { const ranked = ["duty attendance", "duty leave", "approved leave", "on duty", "present", "absent", "leave", "od"]; for (const v of values) { const l = v.toLowerCase(), m = ranked.find(s => l.includes(s)); if (m) return { raw: v, value: normalizeStatus(m) }; } return null; }
  function findSubject(values, date, hour, status) { const ignored = new Set([date?.raw, String(hour||""), status?.raw, status?.value]); const cands = values.map(cleanText).filter(v => v.length > 1 && !ignored.has(v) && !DATE_PATTERNS.some(p => p.test(v)) && !STATUS_WORDS.some(w => v.toLowerCase().includes(w)) && !/^(date|hour|period|subject|status|sl\.?\s*no\.?)$/i.test(v)); return normalizeSubject(cands.sort((a, b) => b.length - a.length)[0] || ""); }
  function normalizeStatus(s) { const l = s.toLowerCase(); return (l === "od" || l === "on duty") ? "Duty Leave" : l.replace(/\b\w/g, c => c.toUpperCase()); }
  function normalizeSubject(s) { const t = cleanText(s), slash = [...t.matchAll(/\d+\/([A-Z]{2,}\d{3,}[A-Z0-9-]*)/gi)]; if (slash.length) return slash[slash.length - 1][1].toUpperCase(); const plain = [...t.matchAll(/\b([A-Z]{2,}\d{3,}[A-Z0-9-]*)\b/gi)]; if (plain.length) return plain[plain.length - 1][1].toUpperCase(); return t.replace(/^\d+\//, ""); }
  function cleanText(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
  
  function toIsoDate(value) {
    const norm = value.replace(/-/g, "/");
    const txt = value.match(/^(\d{1,2})[-\s]+([A-Za-z]{3,9})[-\s]+(\d{2,4})$/);
    if (txt) { const p = new Date(`${txt[2]} ${txt[1]}, ${txt[3]}`); if (!isNaN(p.getTime())) return p.toISOString().slice(0, 10); }
    const d = new Date(norm);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    const pts = norm.split("/");
    if (pts.length === 3) { const [a, b, c] = pts.map(Number); const yr = c < 100 ? 2000 + c : c; const p = a > 12 ? new Date(yr, b - 1, a) : new Date(yr, a - 1, b); if (!isNaN(p.getTime())) return p.toISOString().slice(0, 10); }
    return value;
  }

  function dedupeRecords(records) {
    const seen = new Set();
    return records.filter(r => {
      const key = [r.date?.iso || r.date, r.hour || "", r.subject.toLowerCase(), r.status.value || r.status].join("|");
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(r => ({ date: r.date?.iso || r.date, hour: r.hour || null, subject: normalizeSubject(r.subject), status: r.status.value || r.status, source: r.source || "portal" }));
  }

  // --- V2.0 FLOATING SYNC BUTTON (SUPER IMMORTAL) ---
  function injectFloatingButton() {
    if (document.getElementById("haajar-sync-btn") || !isLikelyRsmsPage()) return;
    
    const btn = document.createElement("button");
    btn.id = "haajar-sync-btn";
    btn.innerHTML = "📊 Sync to Haajar";
    Object.assign(btn.style, {
      position: "fixed", bottom: "24px", right: "24px", zIndex: "999999",
      padding: "12px 20px", background: "#e86a22", color: "white",
      border: "none", borderRadius: "8px", fontWeight: "700",
      boxShadow: "0 8px 24px rgba(71, 25, 36, 0.2)", cursor: "pointer",
      fontFamily: "system-ui, sans-serif", fontSize: "14px", transition: "all 0.2s"
    });
    
    btn.addEventListener("mouseover", () => btn.style.background = "#c85a1a");
    btn.addEventListener("mouseout", () => btn.style.background = "#e86a22");
    
    btn.addEventListener("click", () => {
      btn.innerHTML = "⏳ Syncing...";
      btn.style.background = "#c85a1a";
      
      const res = window.AttendanceCopilotScanner.scan();
      if (!res.ok) {
        btn.innerHTML = "❌ Failed";
        btn.style.background = "#dc3545";
        setTimeout(() => { btn.innerHTML = "📊 Sync to Haajar"; btn.style.background = "#e86a22"; }, 2000);
        return;
      }
      
      chrome.runtime.sendMessage({ type: "HAAJAR_BG_SYNC", payload: res }, (response) => {
        btn.innerHTML = response?.success ? `✅ ${response.msg}` : "❌ Error";
        btn.style.background = response?.success ? "#198754" : "#dc3545";
        setTimeout(() => { btn.innerHTML = "📊 Sync to Haajar"; btn.style.background = "#e86a22"; }, 2000);
      });
    });
    
    // Attach to HTML root so it survives Body wipes!
    document.documentElement.appendChild(btn);
  }

  injectFloatingButton();

  // Watch the HTML root, not the Body!
  const observer = new MutationObserver(() => {
    if (!document.getElementById("haajar-sync-btn") && isLikelyRsmsPage()) {
      injectFloatingButton();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

})();
