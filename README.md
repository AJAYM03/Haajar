# Haajar (ഹാജർ) 📊 

**A privacy-first, zero-backend Chrome Extension built to help students navigate strict attendance mandates without the manual math.**

---

## 🛑 The Backstory: Flying Blind
If you've ever balanced hackathons, tech fests, placement drives, or personal emergencies against a strict 75% (or 80% for internals) attendance mandate, you know the anxiety. 

At my college, our attendance percentage was essentially a closely guarded secret until a few days before exams. Our student portal (RSMS) only gave us raw data: the date, the hour, and the subject code of the classes we missed. If you wanted to step off campus for a valid reason, you had to make a blind choice—guess your "Safe Buffer," do the manual math, and pray you didn't end up in the condonation office two months later.

I'm a big believer in "productive laziness." If a repetitive task annoys me enough, I will gladly spend hours engineering a solution to save myself 5 minutes a week. 

It’s been a couple of months since I graduated, and I wanted to leave something behind to solve this specific anxiety. That’s how **Haajar** was born. 

## 🛠️ What is Haajar?
Haajar is a lightweight Chrome extension that acts as your personal attendance copilot[cite: 2]. It scrapes your raw absence data from the college portal, maps it against your specific batch's timetable, and calculates your exact mathematical buffer locally.

It tells you exactly how many classes you can afford to miss (or need to attend) to stay safe.

**🔒 100% Privacy-First:** Haajar has **ZERO** backend servers. It doesn't ask for your portal password, it doesn't make external API calls, and it steals zero data. It simply reads the HTML currently on your screen and saves the math locally to your browser's storage via `chrome.storage.local`[cite: 2].

---

## ✨ Features (Handling the Edge Cases)
Building this was a massive lesson in how chaotic real-world university scheduling actually is. Haajar is engineered with a few "smart" systems to handle the bureaucracy:

* **Batch-Level CSV Configurations:** Instead of every student manually typing their schedule, a Class Rep can create one "Master CSV" defining the timetable and electives. The whole batch can just copy, paste, and import it in 5 seconds[cite: 2].
* **The "Typo" Translation Engine:** Sometimes an admin logs a subject as `CS800T` instead of `COMPREHENSIVE`. Haajar uses an Alias mapping system to automatically translate institutional typos so your math doesn't break[cite: 2].
* **Dynamic Range Parsing:** College delayed the internal exams? Just type `2026-03-02 to 2026-03-07` into the Setup tab. The engine parses the range and instantly wipes those days from your denominator[cite: 2].
* **Visual Timetable Editor:** Allows individual students to swap out generic electives for their specific choices without breaking the batch configuration[cite: 2].

---

## 🚀 Installation & Setup (Takes 60 Seconds)

### Step 1: Install the Extension
1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top right.
4. Click **"Load unpacked"** and select the Haajar folder[cite: 2].

### Step 2: Import the Timetable
1. Click the Haajar icon in your toolbar and open the **Setup (⚙️)** tab[cite: 2].
2. Paste your batch's **Master CSV** (ask your Class Rep for this) into the import box and click **Import**.
3. *Optional:* Use the Visual Timetable dropdowns to select your specific electives and hit **Save Timetable**.

### Step 3: Sync Your Data
1. Navigate to your **Leave Details** page on the student portal. Click the floating orange **📊 Sync to Haajar** button injected onto the page[cite: 2].
2. Navigate to the **Academic Calendar** page and hit the sync button to pull official holidays[cite: 2].
3. Open the Haajar dashboard to see your Safe Buffers!

---

## ⚠️ Known Issues & The Reality of Scraping
I will be incredibly honest: this extension is a fragile beast. Because it relies on scraping a legacy web portal, there are edge cases.

* **DOM-Coupling:** If the college IT department changes a single CSS class or table layout on the portal tomorrow, the scraper in `src/content.js` will break[cite: 2]. 
* **Color-Blind Calendars:** The calendar scraper only natively detects dates formatted in `<font color="red">`[cite: 2]. It cannot read text announcements (like "College closed tomorrow"). 
* **Special Saturdays:** If the college declares a Saturday working day with a "Tuesday timetable," the math will be slightly off. You will need to manually inject or adjust records.
* **Internal Exams:** You **must** manually input your internal exam date ranges in the Setup tab so the engine knows not to count those days as conducted classes[cite: 2].

---

## 🤝 To My Juniors: Passing the Torch
I built the foundation, but it needs your help to survive the edge cases. I am leaving this code completely open-source. 

If you think this is useful for your batch, the repo is yours. Fork it, test it, break it, and fix the bugs I couldn't. 

### How to Create a Master CSV for Your Batch
You don't need to write this from scratch. Take your class timetable, paste it into ChatGPT/Gemini, and ask it to format it based on the CSV structure found in `src/setup.js`[cite: 2]. It takes two minutes. 

### How to Fix a Broken Scraper
If the portal updates and Haajar stops syncing, you just need to inspect the portal's new HTML and update the `scanAttendanceRecords` regex and table logic inside `src/content.js`[cite: 2].

If nobody wants to pick it up and it eventually breaks, that's completely fine too. It can quietly go down the drain. I'm just happy I took a shot at building it.

---

### License
MIT License. Do whatever you want with it.