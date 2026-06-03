# Haajar (ഹാജർ) 📊

<div align="center">
  <em>A privacy-first, zero-backend Chrome/Edge extension for academic attendance tracking and leave forecasting on the RSMS portal.</em><br>
  <em>Empowering students with data-driven insights to maintain academic compliance.</em>
</div>

---

## 📖 The Backstory
Balancing rigorous coursework with extracurricular activities—like hackathons, placement drives, tech fests, and internships—requires careful time management. 

While the Rajagiri Students' Management System (RSMS) efficiently logs data, manually calculating the impact of future duty leaves, medical absences, or unexpected college closures on your overall attendance percentage is a complex, manual task. Between massive elective blocks, Honours courses, public holidays, and dynamic timetable shifts, forecasting attendance health is difficult.

I wanted a tool that solved this tangible problem using local data without requiring logins, backend databases, or privacy risks. Built with a focus on seamless automation, **Haajar** sits in your browser, parses your RSMS grid, performs the calculations locally, and provides a clear, mathematical overview of your academic standing so you can plan your semester responsibly.

## ✨ Features

* **Zero-Knowledge Architecture:** Runs entirely in your browser using `chrome.storage.local`. No external databases, no API keys, and absolutely zero privacy risks. Your data never leaves your local machine.
* **Leave Impact Simulator:** Select dates for upcoming tech fests, medical leaves, or personal emergencies, and the app will simulate exactly how those absences will impact your subject-wise compliance targets.
* **Smart RSMS Parsing:** Automatically decodes the color-coded RSMS Leave Details grid (Leave, Approved Leave, Duty Leave) and your Marks pages to dynamically build your subject catalog.
* **Compliance Buffer Calculator:** Tells you the exact mathematical buffer you have above the 75% mandate, and provides recovery targets if you fall short.
* **"Saturday Swap" Engine:** Built-in override system to seamlessly handle special academic working days and college holidays.
* **Native College UI:** Designed with the official institutional color palette (Maroon & Orange) for a seamless, professional user experience.

## 🚀 How to Install (Developer Mode)

Since this is an unpacked extension, you can install it locally in seconds:

1. Download or clone this repository.
2. Open Chrome or Edge and navigate to `chrome://extensions/` (or `edge://extensions/`).
3. Turn on **Developer mode** (usually a toggle in the top right corner).
4. Click **Load unpacked** and select the `Haajar` folder.
5. Pin the extension to your toolbar.

## 🛠️ Setup Guide

You only need to configure this once per semester:

1. **Sync your Subjects:** Open your RSMS **Marks/Internal Exam** page and click the Haajar extension. Press **Sync**. This grabs your specific enrolled subjects.
2. **Map the Timetable:** Click the ⚙️ Gear icon in the popup to open the Full-Page Setup. Paste your batch's Master Timetable CSV *(Pro-tip: Your Class Rep can generate one Master CSV for the entire batch to copy-paste)*. 
3. **Lock in Electives:** Any generic elective or honours slots will be highlighted in yellow. Click them and select your exact enrolled course code from the dropdown. *(Note: Semesters before S6 generally don't have major electives, making setup even faster, though you'll still map specific Honours/Minors/Remedial codes here).*
4. **Sync your Leaves:** Open your RSMS **Leave Details** page and press **Sync** one last time. 

From now on, just click the extension to view your live, mathematically accurate attendance dashboard.

## ⚠️ Issues & Limitations

* **The CSV Requirement:** Why not auto-scrape the timetable from the portal? Because official timetables often list generic blocks (like `ELECTIVE 3`). A pure auto-scraper wouldn't know which specific subject you opted for. The CSV + Dropdown method is slightly more manual upfront, but it ensures your attendance math is 100% mathematically flawless by forcing explicit course mapping.
* **Scraper Brittleness:** The `content.js` script relies on the specific DOM structure and hex colors of the current RSMS portal. If the college IT department pushes a major UI update or changes the "Leave" color code, the extension will temporarily fail to read data until a developer updates the regex/color variables in the code.
* **Browser-Bound Storage:** Because Haajar has no backend database to protect your privacy, data is bound to your specific browser profile. If you uninstall the extension or clear your browser's core profile data, your attendance tracking will reset. **Solution:** Use the *Export Diagnostic File* button in the Setup tab to periodically back up your JSON data locally.

## 🧑‍💻 Tech Stack
* **Frontend:** HTML, CSS (Vanilla, utilizing modern CSS Grid/Flexbox architectures)
* **Logic:** Vanilla JavaScript (ES6+)
* **Browser API:** Manifest V3, `chrome.storage.local`, `chrome.scripting`
* **Data Flow:** Idempotent DOM scraping algorithms (No Webpack/Bundlers required for lightweight performance)

---
*Built to simplify academic data management and help students plan smarter.*