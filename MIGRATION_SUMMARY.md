# Attendance Copilot Chat Migration Summary

## Project Goal

Build a browser extension for Rajagiri RSMS that helps students understand subject-wise attendance risk, simulate leave impact, and plan recovery. The product must be student-compliance oriented, not a bunk planner.

## Current Deliverable

Folder:

`outputs/attendance-copilot-extension`

This is a loadable Chrome/Edge Manifest V3 extension.

## Core Product Model

Attendance Copilot combines:

- RSMS Leave Details page: absence/leave/duty attendance records.
- RSMS marks/attendance page: class code plus subject code/name catalog.
- Student timetable: entered from the semester timetable PDF using bulk import or manual grid.
- Attendance windows: Internal 1, Internal 2, Semester.
- Holidays: manually entered for now.

Presence is inferred from timetable slots that do not have a negative leave/absence record.

## Important RSMS Discoveries

- Leave Details page is a color-coded grid, not text-status rows.
- Header has `Date/Hours` and hour columns `1` through `7`.
- Status is encoded by cell color:
  - red = `Leave`
  - green = `Approved Leave`
  - orange = `Duty Leave`
  - yellow = `Duty Attendance`
- Subject cells include numeric prefixes, e.g. `101003/CS800A`; the extension normalizes this to `CS800A`.
- Class code appears in a dropdown, e.g. `2026S8CS-A`.
- Marks/attendance pages contain the most reliable subject catalog:
  - code + subject name
  - theory and lab rows
  - examples: `CS800A = DISTRIBUTED COMPUTING`, `CO322S = Data Structures Lab`.
- Timetable PDFs may not contain class code, so the extension links timetable data to the class code captured from RSMS.

## Current Features Implemented

- Manifest V3 extension.
- Popup UI with Dashboard, Simulator, Setup tabs.
- Sync button injects scanner only on demand via `activeTab` and `scripting`.
- No always-on content script.
- RSMS Leave Details parser.
- RSMS marks/attendance subject catalog parser.
- Class/semester profile extraction from dropdown.
- Per-class data separation:
  - records
  - subject catalog
  - timetable
  - attendance windows
  - holidays
  - last sync metadata
- Class selector in dashboard.
- Bulk timetable import in Setup.
- Manual record import.
- Leave simulator.
- Safe leave buffer and recovery calculation.
- Local persistence using `chrome.storage.local`.

## Current Files

- `manifest.json`: extension manifest.
- `src/content.js`: RSMS page scanner.
- `src/popup.html`: popup structure.
- `src/popup.css`: popup styling.
- `src/popup.js`: state management, sync flow, calculations, simulator.
- `src/background.js`: initial default storage setup.
- `fixtures/rsms-leave-details.html`: local fixture for leave grid testing.
- `README.md`: usage and testing instructions.

## Current Test Status

Verified:

- `manifest.json` parses as JSON.
- `src/content.js` passes `node --check`.
- `src/popup.js` passes `node --check`.
- No leftover `Â` or replacement-character encoding artifacts found in extension source files.

Manual browser testing done by user:

- Sync button initially failed silently, then was fixed.
- Leave Details page sync now imports real records.
- One test imported 23 rows from RSMS Leave Details.
- Multi-semester mixing was observed and then fixed by introducing per-class profiles.
- Marks/attendance page subject code/name extraction was added for theory and lab rows.

Not yet fully automated:

- Browser-based integration tests.
- OCR/PDF timetable parsing.
- Production Chrome Web Store packaging.

## Recommended Test Flow

1. Reload unpacked extension in `chrome://extensions`.
2. Open RSMS marks/attendance page.
3. Select a class code, e.g. `2026S8CS-A`.
4. Select `Attendance`, press RSMS `Submit`.
5. Press extension `Sync`.
6. Confirm message like `Synced 8 subjects for 2026S8CS-A`.
7. Open Setup tab.
8. Paste timetable rows into Bulk import timetable.
9. Click Import Timetable Rows, review grid, then Save Timetable.
10. Open RSMS Leave Details page for same class.
11. Press extension Sync.
12. Dashboard should show only active class records.
13. Switch class selector to confirm other semesters remain separate.

## Known Limitations

- Timetable PDF text extraction did not work locally for `S8 cs A TT.pdf`; bulk import is the current fallback.
- Attendance windows use manually entered dates or first/last synced leave record as temporary defaults.
- Cancelled classes and teacher swaps are not modeled yet.
- Academic calendar import is not implemented yet.
- Official PDF calibration is not implemented yet.
- Screenshots/OCR import is not implemented yet.

## Production Priorities Next

1. Add export/import backup for extension state.
2. Add stable RSMS selector-based parsing if actual HTML is available.
3. Add timetable PDF/OCR import.
4. Add academic calendar import.
5. Add official attendance PDF calibration.
6. Add automated browser tests with fixture pages.
7. Add clearer setup checklist in the popup for new semesters.
