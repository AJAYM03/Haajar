# Haajar (ഹാജർ) 📊

A privacy-first browser extension for the Rajagiri Students' Management System (RSMS). Haajar helps students calculate subject-wise attendance percentages, simulate the impact of future leaves, and map out exactly how many classes they need to attend to stay above the 75% baseline. 

All data is stored locally using `chrome.storage.local`—no external databases, no logins, and zero privacy risks[cite: 1].

## 🛠️ Current Status: Developer Handoff
**The Core Bug (Why everything shows 100%):** 
The extension successfully scrapes absence records and generates a timetable, but fails to map them together. 
* **The Cause:** The timetable UI uses shorthand text (like `DC` or `PROJECT`), but the RSMS Leave Details page logs absences using strict alphanumeric codes (like `CS800A` and `CS822U`)[cite: 1, 2]. 
* **The Result:** Because `DC` !== `CS800A`, the logic assumes there are 0 cuts for `DC`, leaving attendance at a default 100%. 
* **The Fix Needed:** The timetable input grid needs to enforce matching against the scraped `subjectCatalog` so the records correctly sync.

## ✨ Features
* **Zero-Knowledge Architecture:** Runs entirely in the browser. Scanner only executes on demand when "Sync" is pressed[cite: 1].
* **Smart Parsing:** Decodes the color-coded RSMS leave grid (Leave, Approved Leave, Duty Leave)[cite: 1].
* **Bunk Simulator:** Pick future dates to see how taking days off will impact specific subject percentages[cite: 1].
* **Recovery Guidance:** Calculates the exact "Safe Buffer" of classes you can miss, or the exact number you must attend to recover[cite: 1].

## 🚀 How to Install for Development
1. Clone this repository.
2. Open Chrome or Edge and navigate to `chrome://extensions/` or `edge://extensions/`[cite: 1].
3. Enable **Developer mode** in the top right[cite: 1].
4. Click **Load unpacked** and select the `Haajar` folder[cite: 1].

## 🧪 Testing Protocol
Since the extension requires an RSMS portal, test it using historical data.

1. **Profile Sync:** Open an old RSMS **Marks/Internal Exam** page and press **Sync** to capture the class code and subject catalog[cite: 1].
2. **Timetable Setup:** Go to the extension's Setup tab. Paste the Master CSV below into the bulk import box and click **Import**[cite: 1].
3. **Leave Sync:** Open the historical RSMS **Leave Details** page and press **Sync**[cite: 1].
4. Check the Dashboard to verify calculations. 

### S8 Master CSV for Testing
Use this CSV block to quickly populate the timetable for testing[cite: 1]. Replace the `_CODE` placeholders with exact RSMS alphanumeric codes to test the mapping fix:

```csv
Monday, COMPREHENSIVE_CODE, CS822U, ELECTIVE_4_CODE, CS800A, ELECTIVE_5_CODE, ELECTIVE_5_CODE, 
Tuesday, COMPREHENSIVE_CODE, CS800A, CS822U, ELECTIVE_3_CODE, CS822U, CS822U, 
Wednesday, CS822U, CS800A, CS822U, ELECTIVE_3_CODE, ELECTIVE_4_CODE, ELECTIVE_5_CODE, 
Thursday, ELECTIVE_5_CODE, CS800A, CS822U, ELECTIVE_3_CODE, ELECTIVE_4_CODE, MENTORING, 
Friday, ELECTIVE_5_CODE, CS800A, CS822U, HONORS_CODE, ELECTIVE_3_CODE, ELECTIVE_5_CODE, CS822U