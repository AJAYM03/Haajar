(() => {
  if (window.__attendanceCopilotContentLoaded && window.AttendanceCopilotScanner) return;
  window.__attendanceCopilotContentLoaded = true;

  const DATE_PATTERNS = [
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/,
    /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/,
    /\b\d{1,2}[-\s]+[A-Za-z]{3,9}[-\s]+\d{2,4}\b/,
    /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\b/
  ];

  const STATUS_WORDS = [
    "absent",
    "leave",
    "approved leave",
    "duty leave",
    "duty attendance",
    "present",
    "od",
    "on duty"
  ];

  const RSMS_STATUS_BY_COLOR = {
    leave: "Leave",
    approvedLeave: "Approved Leave",
    dutyLeave: "Duty Leave",
    dutyAttendance: "Duty Attendance"
  };

  const SUBJECT_CODE_PATTERN = /\b(?:\d+\/)?[A-Z]{2,}\d{3,}[A-Z0-9-]*\b/i;

  window.AttendanceCopilotScanner = {
    scan: () => {
      try {
        const classInfo = getSelectedClassInfo();
        return {
          ok: true,
          records: scanAttendanceRecords(),
          classInfo,
          subjectCatalog: scanSubjectCatalog(),
          pageTitle: document.title,
          scannedAt: new Date().toISOString()
        };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "ATTENDANCE_COPILOT_SCAN") return;

    sendResponse(window.AttendanceCopilotScanner.scan());

    return true;
  });

  function scanAttendanceRecords() {
    const rsmsRecords = scanRsmsLeaveGrid();
    if (rsmsRecords.length) return dedupeRecords(rsmsRecords);
    if (isLikelyRsmsPage()) return [];

    const rows = [...document.querySelectorAll("table tr")];
    const tableRecords = rows.flatMap(parseTableRow).filter(Boolean);
    if (tableRecords.length) return dedupeRecords(tableRecords);

    const textRecords = parsePlainText(document.body.innerText || "");
    return dedupeRecords(textRecords);
  }

  function getSelectedClassInfo() {
    const select = [...document.querySelectorAll("select")].find((element) =>
      [...element.options].some((option) => parseClassCode(option.value) || parseClassCode(option.textContent))
    );

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

    return {
      classCode,
      batchYear: match[1],
      semesterNumber: Number(match[2]),
      semester: `Semester ${match[2]}`,
      program: match[3],
      section: match[4] || "",
      label: `${classCode} - Semester ${match[2]} - ${match[3]}${match[4] ? `-${match[4]}` : ""}`
    };
  }

  function scanSubjectCatalog() {
    const catalog = {};
    [...document.querySelectorAll("tr")].forEach((row) => {
      const entry = parseSubjectCatalogRow(row);
      if (!entry) return;
      catalog[entry.code] = entry;
    });

    return catalog;
  }

  function parseSubjectCatalogRow(row) {
    const cells = getCells(row).map((cell) => cleanText(cell.innerText)).filter(Boolean);
    if (cells.length < 2) return null;

    const headerText = cells.join(" ").toLowerCase();
    if (/\b(code|subject|sl\s*no|roll\s*no|name)\b/.test(headerText) && !cells.some((cell) => SUBJECT_CODE_PATTERN.test(cell))) {
      return null;
    }

    const codeIndex = cells.findIndex((cell) => SUBJECT_CODE_PATTERN.test(cell));
    if (codeIndex === -1) return null;

    const code = normalizeSubject(cells[codeIndex]);
    const name = cells.slice(codeIndex + 1).find((cell) =>
      cell.length > 2 &&
      !SUBJECT_CODE_PATTERN.test(cell) &&
      !/^\d+$/.test(cell) &&
      !/^[A-Z0-9/-]+$/.test(cell)
    );

    if (!code || !name) return null;

    return {
      code,
      name,
      kind: /lab\b/i.test(name) ? "lab" : "theory"
    };
  }

  function isLikelyRsmsPage() {
    const pageText = cleanText(document.body?.innerText || "").toLowerCase();
    return pageText.includes("rajagiri students") ||
      pageText.includes("leave details") ||
      pageText.includes("r.s.m.s") ||
      pageText.includes("rsms");
  }

  function scanRsmsLeaveGrid() {
    const tables = [...document.querySelectorAll("table")];

    for (const table of tables) {
      const rows = [...table.querySelectorAll("tr")];
      if (!looksLikeRsmsLeaveTable(rows)) continue;

      const headerIndex = findRsmsHeaderIndex(rows);
      const hourByColumn = buildRsmsHourMap(rows[headerIndex]);
      const candidateRows = headerIndex === -1 ? rows : rows.slice(headerIndex + 1);
      const records = candidateRows.flatMap((row) => parseRsmsLeaveRow(row, hourByColumn));

      if (records.length) return records;
    }

    return [];
  }

  function looksLikeRsmsLeaveTable(rows) {
    const datedRows = rows.filter((row) => getCells(row).some((cell) => findDate([cell.innerText])));
    const subjectRows = datedRows.filter((row) =>
      getCells(row).some((cell) => SUBJECT_CODE_PATTERN.test(cleanText(cell.innerText)))
    );
    return subjectRows.length > 0;
  }

  function findRsmsHeaderIndex(rows) {
    return rows.findIndex((row) => {
      const cells = getCells(row).map((cell) => cleanText(cell.innerText).toLowerCase());
      const hourCount = cells.filter((text) => /^[1-7]$/.test(text)).length;
      const hasDateHours = cells.some((text) => /date\s*\/?\s*hours?/.test(text));
      return hourCount >= 3 || (hasDateHours && hourCount >= 1);
    });
  }

  function buildRsmsHourMap(headerRow) {
    if (!headerRow) return [null, 1, 2, 3, 4, 5, 6, 7];

    const hourByColumn = [];
    getCells(headerRow).forEach((cell) => {
      const text = cleanText(cell.innerText);
      const hour = /^[1-7]$/.test(text) ? Number(text) : null;
      const colspan = Number(cell.getAttribute("colspan") || 1);
      for (let index = 0; index < colspan; index += 1) {
        hourByColumn.push(hour);
      }
    });

    const hasHours = hourByColumn.some(Boolean);
    return hasHours ? hourByColumn : [null, 1, 2, 3, 4, 5, 6, 7];
  }

  function parseRsmsLeaveRow(row, hourByColumn) {
    const cells = getCells(row);
    const dateCellIndex = cells.findIndex((cell) => findDate([cell.innerText]));
    if (dateCellIndex === -1) return [];

    const date = findDate([cells[dateCellIndex].innerText]);
    if (!date) return [];

    const records = [];
    let logicalColumn = 0;

    cells.forEach((cell, index) => {
      const colspan = Number(cell.getAttribute("colspan") || 1);
      if (index <= dateCellIndex) {
        logicalColumn += colspan;
        return;
      }

      const subject = normalizeSubject(cleanText(cell.innerText));
      const status = statusFromCellColor(cell);

      if (subject && status) {
        for (let offset = 0; offset < colspan; offset += 1) {
          const hour = hourByColumn[logicalColumn + offset];
          if (hour) {
            records.push({
              date,
              hour,
              subject,
              status,
              source: "rsms-leave-grid"
            });
          }
        }
      }

      logicalColumn += colspan;
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
      const htmlColor = current.getAttribute?.("bgcolor");
      if (htmlColor) return htmlColor;

      const inlineBackground = current.style?.backgroundColor || current.style?.background;
      if (inlineBackground) return inlineBackground;

      const color = getComputedStyle(current).backgroundColor;
      if (color && color !== "transparent" && !color.endsWith(", 0)")) return color;
      current = current.parentElement;
    }
    return null;
  }

  function parseRgb(color) {
    const namedColors = {
      red: { r: 255, g: 0, b: 0 },
      maroon: { r: 128, g: 0, b: 0 },
      green: { r: 0, g: 128, b: 0 },
      darkgreen: { r: 0, g: 100, b: 0 },
      orange: { r: 255, g: 165, b: 0 },
      yellow: { r: 255, g: 255, b: 0 }
    };
    const normalized = cleanText(color).toLowerCase().replace(/\s+/g, "");
    if (namedColors[normalized]) return namedColors[normalized];

    const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const value = hex[1].length === 3
        ? hex[1].split("").map((char) => char + char).join("")
        : hex[1];
      return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
      };
    }

    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3])
    };
  }

  function getCells(row) {
    return [...row.querySelectorAll("th,td")];
  }

  function parseTableRow(row) {
    const cells = [...row.querySelectorAll("th,td")].map((cell) =>
      cleanText(cell.innerText)
    );
    if (cells.length < 3) return [];

    const joined = cells.join(" ");
    if (!DATE_PATTERNS.some((pattern) => pattern.test(joined))) return [];
    if (!STATUS_WORDS.some((word) => joined.toLowerCase().includes(word))) return [];

    const date = findDate(cells);
    const hour = findHour(cells);
    const status = findStatus(cells);
    const subject = findSubject(cells, date, hour, status);

    if (!date || !subject || !status) return [];
    return [{ date, hour, subject, status, source: "portal" }];
  }

  function parsePlainText(text) {
    return text
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean)
      .flatMap((line) => {
        const date = findDate([line]);
        const status = findStatus([line]);
        if (!date || !status) return [];

        const chunks = line
          .replace(date.raw, " ")
          .replace(status.raw, " ")
          .split(/\s{2,}|\t+/)
          .map(cleanText)
          .filter(Boolean);

        const hour = findHour(chunks);
        const subject = findSubject(chunks, date, hour, status);
        if (!subject) return [];

        return [{ date, hour, subject, status, source: "portal" }];
      });
  }

  function findDate(values) {
    for (const value of values) {
      for (const pattern of DATE_PATTERNS) {
        const match = value.match(pattern);
        if (match) return { raw: match[0], iso: toIsoDate(match[0]) };
      }
    }
    return null;
  }

  function findHour(values) {
    for (const value of values) {
      const hourMatch = value.match(/\b(?:hour|period|hr)?\s*([1-7])\b/i);
      if (hourMatch) return Number(hourMatch[1]);
    }
    return null;
  }

  function findStatus(values) {
    const ranked = [
      "duty attendance",
      "duty leave",
      "approved leave",
      "on duty",
      "present",
      "absent",
      "leave",
      "od"
    ];

    for (const value of values) {
      const lower = value.toLowerCase();
      const match = ranked.find((status) => lower.includes(status));
      if (match) return { raw: value, value: normalizeStatus(match) };
    }

    return null;
  }

  function findSubject(values, date, hour, status) {
    const ignored = new Set([
      date?.raw,
      String(hour || ""),
      status?.raw,
      status?.value
    ]);

    const candidates = values
      .map((value) => cleanText(value))
      .filter((value) => value.length > 1)
      .filter((value) => !ignored.has(value))
      .filter((value) => !DATE_PATTERNS.some((pattern) => pattern.test(value)))
      .filter((value) => !STATUS_WORDS.some((word) => value.toLowerCase().includes(word)))
      .filter((value) => !/^(date|hour|period|subject|status|sl\.?\s*no\.?)$/i.test(value));

    return normalizeSubject(candidates.sort((a, b) => b.length - a.length)[0] || "");
  }

  function normalizeStatus(status) {
    const lower = status.toLowerCase();
    if (lower === "od" || lower === "on duty") return "Duty Leave";
    return lower.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function normalizeSubject(subject) {
    const text = cleanText(subject);
    const slashCodes = [...text.matchAll(/\d+\/([A-Z]{2,}\d{3,}[A-Z0-9-]*)/gi)];
    if (slashCodes.length) return slashCodes[slashCodes.length - 1][1].toUpperCase();

    const plainCodes = [...text.matchAll(/\b([A-Z]{2,}\d{3,}[A-Z0-9-]*)\b/gi)];
    if (plainCodes.length) return plainCodes[plainCodes.length - 1][1].toUpperCase();

    return text.replace(/^\d+\//, "");
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function toIsoDate(value) {
    const normalized = value.replace(/-/g, "/");
    const textDate = value.match(/^(\d{1,2})[-\s]+([A-Za-z]{3,9})[-\s]+(\d{2,4})$/);
    if (textDate) {
      const parsed = new Date(`${textDate[2]} ${textDate[1]}, ${textDate[3]}`);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }

    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);

    const parts = normalized.split("/");
    if (parts.length === 3) {
      const [a, b, c] = parts.map(Number);
      const year = c < 100 ? 2000 + c : c;
      const parsed = a > 12 ? new Date(year, b - 1, a) : new Date(year, a - 1, b);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }

    return value;
  }

  function dedupeRecords(records) {
    const seen = new Set();
    return records.filter((record) => {
      const key = [
        record.date?.iso || record.date,
        record.hour || "",
        record.subject.toLowerCase(),
        record.status.value || record.status
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((record) => ({
      date: record.date?.iso || record.date,
      hour: record.hour || null,
      subject: normalizeSubject(record.subject),
      status: record.status.value || record.status,
      source: record.source || "portal"
    }));
  }
})();
