# Attendance Copilot Extension

This is a loadable Chrome/Edge Manifest V3 prototype for the Attendance Copilot idea.

## What It Does

- Syncs attendance/absence rows from the currently open student portal page.
- Syncs class code and subject-code mappings from RSMS marks pages.
- Stores data locally with `chrome.storage.local`.
- Keeps each synced class/semester separate by RSMS class code.
- Calculates subject-wise attendance using absence records plus your timetable.
- Supports Internal 1, Internal 2, and Semester attendance windows.
- Simulates the impact of planned leave dates.
- Shows recovery guidance when a subject falls below the target.
- Allows manual CSV-style record import while portal parsing is being tuned.

## Load It In Chrome Or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked**.
4. Select this folder:

   `attendance-copilot-extension`

5. Open your attendance portal page.
6. Click the extension icon and press **Sync**.

The scanner runs only when you press **Sync**. It is not an always-on content script.

## Portal Parser Notes

The content script has a dedicated parser for the RSMS Leave Details grid shown by Rajagiri. It detects the table with `Date/Hours`, reads hour columns `1` through `7`, and maps the cell background color to attendance status:

- red = `Leave`
- green = `Approved Leave`
- orange = `Duty Leave`
- yellow = `Duty Attendance`

It also strips the RSMS numeric prefix from subject cells, so `101003/CS822U` is stored as `CS822U`. That makes portal records easier to match with timetable entries.

The same Sync button also works on the RSMS marks/internal exam page. On that page it may import `0` leave records, but it still updates:

- class code, such as `2026S8CS-A`
- semester identity, such as `Semester 8`
- subject codes and names, such as `CS800A = DISTRIBUTED COMPUTING`
- lab/theory subject rows when they appear in code-name tables

The fallback parser is intentionally heuristic because college portals differ. It looks for table rows or text lines containing:

- a date
- an hour/period when available
- a subject
- a status such as `Absent`, `Leave`, `Approved Leave`, `Duty Leave`, or `Duty Attendance`

If your actual portal has stable HTML IDs/classes, the next best step is to replace the heuristic parser in `src/content.js` with portal-specific selectors.

## Test Fixture

Use `fixtures/rsms-leave-details.html` to test the extension without relying on the old portal account.

1. Load the extension unpacked.
2. Enable **Allow access to file URLs** for the extension, or serve the folder from a local web server.
3. Open `fixtures/rsms-leave-details.html` in the browser.
4. Click the extension icon and press **Sync**.
5. Expected imported records from the fixture: `15`.

## RSMS S7 Test Setup

After syncing the `2025S7CS-A` page, use this temporary inferred timetable to test the dashboard. This is inferred from the leave grid you shared, not the official timetable.

If you sync another class/semester, it will appear in the class selector on the dashboard. Each class has its own records, subject catalog, attendance windows, holidays, and timetable.

Set the Semester window to:

- Start date: `2025-08-11`
- End date: `2025-10-13`
- Target: `75`

Fill the timetable like this:

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Monday | CS700A | CS722U | CS722U | CE701C-B1 | CS706B-B1 | CO700D | |
| Tuesday | CE701C-B1 | CS722S | | | | | |
| Wednesday | CS700A | CO700D | | | | | |
| Thursday | | | | | | | |
| Friday | | CS706B-B1 | CO700D | | CS722T | CS722T | CS722T |

Known subject names from the attached subject list:

| Code | Subject |
| --- | --- |
| CS700A | ARTIFICIAL INTELLIGENCE |
| CS701B | MACHINE LEARNING |
| CS706B-B1 | WEB PROGRAMMING-B1 |
| CS707B | NATURAL LANGUAGE PROCESSING |
| CE701C-B1 | ENVIRONMENTAL IMPACT ASSESSMENT-B1 |
| CO700D | INDUSTRIAL SAFETY ENGINEERING |

Codes visible in the leave grid but not present in the attached subject-name table:

- `CS722U`
- `CS722S`
- `CS722T`

## Timetable Import

College timetable PDFs often do not include the RSMS class code, so the production flow is:

1. Open the RSMS marks/internal exam page and press **Sync** to capture the class code and subject names.
2. Open **Setup** in the extension for that class.
3. Paste the timetable rows from the PDF into **Bulk import timetable**.
4. Click **Import Timetable Rows**.
5. Review the 7 hour boxes and click **Save Timetable**.

Bulk timetable row format:

```csv
Monday, CS800A, CS801B, CS802B-B1, MA805B, CS804C-B1, CS806C, CS807C
Tuesday, CS800A, CS801B, CS802B-B1, MA805B, CS804C-B1, CS806C, CS807C
Wednesday, CS800A, CS801B, CS802B-B1, MA805B, CS804C-B1, CS806C, CS807C
Thursday, CS800A, CS801B, CS802B-B1, MA805B, CS804C-B1, CS806C, CS807C
Friday, CS800A, CS801B, CS802B-B1, MA805B, CS804C-B1, CS806C, CS807C
```

The timetable is saved only under the active class/semester, so `2026S8CS-A` and `2025S7CS-A` do not share timetable settings.

## Manual Record Format

Use one row per missed/recorded period:

```csv
2026-07-10, 2, DBMS, Absent
2026-07-11, 5, OS, Duty Leave
```

## Important MVP Assumptions

- Presence is inferred when no absence/leave record exists for a generated timetable slot.
- `Duty Leave`, `Duty Attendance`, `Approved Leave`, `Present`, `OD`, and `On Duty` count positively.
- `Absent` and plain `Leave` count negatively.
- Holidays entered in setup are excluded from conducted-class estimates.
- Teacher swaps and cancelled classes are not modeled yet.

## Suggested Next Steps

- Tune `src/content.js` against screenshots or saved HTML from the real portal.
- Add academic calendar import.
- Add official PDF calibration once attendance reports are available.
- Add export/import backup for local extension data.
