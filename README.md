# Haajar (ഹാജർ) 📊

A privacy-first, zero-backend Chrome Extension built to help RSET students navigate strict attendance mandates without the manual math.

---

## 🛑 The Backstory: Flying Blind

If you've ever balanced hackathons, tech fests, placement drives, or personal emergencies against a strict 75% (or 80% for internals) attendance mandate, you know the anxiety.

At RSET, our attendance percentage was essentially a closely guarded secret until a few days before exams. Our student portal (RSMS) only gave us raw data: the date, the hour, and the subject code of the classes we missed. If you wanted to step off campus for a valid reason, you had to make a blind choice—guess your "Safe Buffer," do the mental math, and pray you didn't end up in the condonation office two months later.

I'm a big believer in "productive laziness." If a repetitive task annoys me enough, I will gladly spend hours engineering a solution to save myself 5 minutes a week. Now that I've graduated, I wanted to leave something behind to solve this specific anxiety. That’s how Haajar was born.

---

## 🛠️ What is Haajar?

Haajar is a lightweight Chrome extension that acts as your personal attendance copilot. It scrapes your raw absence data from RSMS, maps it against your specific batch's timetable, and calculates your exact mathematical buffer locally.

It tells you exactly how many classes you can afford to miss (or need to attend) to stay safe.

### 🔒 100% Privacy-First

Haajar has **ZERO backend servers**. It doesn't ask for your portal password, it makes no external API calls, and it collects zero data. It simply reads the HTML on your screen and saves the math locally to your browser via `chrome.storage.local`.

---

## ✨ Features

Real-world university scheduling is chaotic. Haajar is engineered to handle the bureaucracy:

### Batch-Level CSV Configurations

A Class Rep can create one "Master CSV" defining the timetable. The whole batch can just copy, paste, and import it in 5 seconds.

### Auto-Syncing Holidays & Internals

Haajar automatically scrapes the RSMS Academic Calendar for holidays and internal exam dates. It keeps your attendance calculations accurate without you lifting a finger.

### Manual Override & Range Picker

Need to adjust exam dates? Use the native date-picker in the Setup tab to lock in your exact Internal Exam windows. Your manual overrides always take priority over portal syncs.

### The "Typo" Translation Engine

If an admin logs a subject as `CS800T` instead of `COMPREHENSIVE`, Haajar automatically translates the typo so your math doesn't break.

### Visual Timetable Editor

Allows individual students to swap out generic electives for their specific choices.

---

## 🚀 Installation & Setup (Takes 60 Seconds)

### 1. Install

Download this repository and load the unpacked extension into Chrome via:

```
chrome://extensions/
```

(Developer Mode enabled)

### 2. Import

Open the Haajar Setup tab (⚙️).

Paste your batch's Master CSV (ask your Class Rep) and click **Import**.

### 3. Customize

Review the visual grid to select your specific electives and hit **Save**.

### 4. Sync

Navigate to your Leave Details page or the Academic Calendar on RSMS.

A floating **📊 Sync to Haajar** button will appear automatically.

Click it to update your data.

---

## 📄 The Master CSV Format

To set up a class, you need a "Master CSV." This tells the extension how to map the raw subject codes from the portal to your actual timetable.

You can feed your class schedule to Gemini/ChatGPT and ask it to output this format:

```csv
CLASSCODE, 2026S8CS-A

MAPPING, CORE_DC, CS800A, DISTRIBUTED COMPUTING
MAPPING, CORE_COMP, COMPREHENSIVE, COMPREHENSIVE
MAPPING, PROJECT, CS822U, PROJECT
MAPPING, HONOURS, CS822H, MINIPROJECT (HONOURS)
MAPPING, MENTOR, MENTORING, MENTORING
MAPPING, FREE, FREE, FREE HOUR

MAPPING, ELEC_1, CS803D, IMAGE PROCESSING TECHNIQUE
MAPPING, ELEC_2, CS804C-B1, DATA COMPRESSION TECHNIQUES-B1
MAPPING, ELEC_3, CS802B-B1, PROGRAMMING PARADIGMS

MAPPING, OPT_1, CS801B, DEEP LEARNING
MAPPING, OPT_2, MA805B, FUZZY SET THEORY AND APPLICATIONS
MAPPING, OPT_3, CS806C, DATA MINING
MAPPING, OPT_4, CS807C, MOBILE COMPUTING
MAPPING, OPT_5, CS802D, BLOCKCHAIN TECHNOLOGIES
MAPPING, OPT_6, CS805D, SOFTWARE TESTING

MAPPING, CS800T, COMPREHENSIVE, COMPREHENSIVE

Monday, PROJECT, PROJECT, CORE_DC, CORE_COMP, ELEC_2, ELEC_1, FREE
Tuesday, CORE_COMP, CORE_DC, PROJECT, PROJECT, ELEC_3, ELEC_2, FREE
Wednesday, PROJECT, PROJECT, PROJECT, HONOURS, CORE_DC, ELEC_3, FREE
Thursday, ELEC_3, ELEC_2, PROJECT, PROJECT, ELEC_1, CORE_DC, FREE
Friday, ELEC_1, ELEC_2, ELEC_3, MENTOR, PROJECT, PROJECT, PROJECT
```

---

## ⚠️ The Reality of Scraping (Known Issues)

I will be incredibly honest: this extension is a fragile beast.

### DOM-Coupling

If the college IT department changes a single table layout on the portal tomorrow, the scraper will break.

### Special Saturdays

If the college declares a Saturday working day with a "Tuesday timetable," the math might need a manual record adjustment in the Setup tab.

---

## 🤝 To My RSET Juniors: Passing the Torch

I built the foundation, but it needs your help to survive the edge cases.

I am leaving this code completely open-source.

If you think this is useful for your batch, the repo is yours. Fork it, test it, break it, and fix the bugs I couldn't.

If the portal updates and Haajar stops syncing, you just need to inspect the new HTML and update the selectors in `src/content.js`.

If nobody wants to pick it up and it eventually breaks, that's completely fine too. It can quietly go down the drain.

I'm just happy I took a shot at building it.

---

## Credits

Haajar was started and originally built by [AJAYM03](https://github.com/AJAYM03) as a small attempt to make attendance decisions less stressful and more transparent for RSET students.

If you fork it, improve it, or adapt it for another batch, a small credit back to the original repo is appreciated. No drama, no gatekeeping; just a note so the project trail stays clear.

---

## License

MIT License. See [LICENSE](LICENSE).

Use it, fork it, fix it, adapt it.
