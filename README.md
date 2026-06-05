# Haajar (ഹാജർ) 📊 

**A privacy-first, zero-backend Chrome Extension built to help RSET students navigate strict attendance mandates without the manual math.**

---

## 🛑 The Backstory: Flying Blind
If you've ever balanced hackathons, tech fests, placement drives, or personal emergencies against a strict 75% (or 80% for internals) attendance mandate, you know the anxiety. 

At RSET, our attendance percentage was essentially a closely guarded secret until a few days before exams. Our student portal (RSMS) only gave us raw data: the date, the hour, and the subject code of the classes we missed. If you wanted to step off campus for a valid reason, you had to make a blind choice—guess your "Safe Buffer," do the mental math, and pray you didn't end up in the condonation office two months later.

I'm a big believer in "productive laziness." If a repetitive task annoys me enough, I will gladly spend hours engineering a solution to save myself 5 minutes a week. Now that I've graduated, I wanted to leave something behind to solve this specific anxiety. That’s how **Haajar** was born. 

## 🛠️ What is Haajar?
Haajar is a lightweight Chrome extension that acts as your personal attendance copilot. It scrapes your raw absence data from RSMS, maps it against your specific batch's timetable, and calculates your exact mathematical buffer locally.

It tells you exactly how many classes you can afford to miss (or need to attend) to stay safe.

**🔒 100% Privacy-First:** Haajar has **ZERO** backend servers. It doesn't ask for your portal password, it makes no external API calls, and it collects zero data. It simply reads the HTML on your screen and saves the math locally to your browser via `chrome.storage.local`.

---

## ✨ Features
Real-world university scheduling is chaotic. Haajar is engineered to handle the bureaucracy:

* **Batch-Level CSV Configurations:** A Class Rep can create one "Master CSV" defining the timetable. The whole batch can just copy, paste, and import it in 5 seconds.
* **The "Typo" Translation Engine:** If an admin logs a subject as `CS800T` instead of `COMPREHENSIVE`, Haajar automatically translates the typo so your math doesn't break.
* **Dynamic Range Parsing:** College delayed the internal exams? Just type `2026-03-02 to 2026-03-07` into the Setup tab to instantly wipe those days from your denominator.
* **Visual Timetable Editor:** Allows individual students to swap out generic electives for their specific choices.

---

## 🚀 Installation & Setup (Takes 60 Seconds)

1. **Install:** Download this repository and load the unpacked extension into Chrome via `chrome://extensions/` (Developer Mode enabled).
2. **Import:** Open the Haajar Setup tab (⚙️). Paste your batch's **Master CSV** (ask your Class Rep) and click **Import**.
3. **Customize:** Use the dropdowns in the visual grid to select your specific electives and hit Save.
4. **Sync:** Navigate to your **Leave Details** page on RSMS and click the floating orange **📊 Sync to Haajar** button. *(Note: Skip the Academic Calendar page for now—the sync is currently bugged! Just manually enter holidays in the Setup tab).*

---

## ⚠️ The Reality of Scraping (Known Issues)
I will be incredibly honest: this extension is a fragile beast. I’ve tested it as much as I could, but if I'm being fully transparent, I still worry there are cracks I missed. Because it relies on scraping a legacy web portal, there are edge cases.

* **DOM-Coupling:** If the college IT department changes a single table layout on the portal tomorrow, the scraper will break. 
* **Broken Calendar Sync:** I thought this was working, but the Academic Calendar sync is currently bugged (it accidentally creates a new class profile instead of merging data safely). You **must** manually input holidays and internal exam ranges in the Setup tab so the engine knows not to count those days.
* **Special Saturdays:** If the college declares a Saturday working day with a "Tuesday timetable," the math will be slightly off. You will need to manually adjust records in the Setup tab.

---

## 🤝 To My RSET Juniors: Passing the Torch
I built the foundation, but it needs your help to survive the edge cases. I am leaving this code completely open-source. 

If you think this is useful for your batch, the repo is yours. Fork it, test it, break it, and fix the bugs I couldn't. If the portal updates and Haajar stops syncing, you just need to inspect the new HTML and update the regex in `src/content.js`.

*(Pro-tip: To create a Master CSV for your batch, just paste your class timetable into Gemini/ChatGPT and ask it to format it based on the CSV structure found in `src/setup.js`. Takes two minutes).*

If nobody wants to pick it up and it eventually breaks, that's completely fine too. It can quietly go down the drain. I'm just happy I took a shot at building it.

---

**License:** MIT License. Do whatever you want with it.