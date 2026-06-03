chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["attendanceCopilot"], (result) => {
    if (result.attendanceCopilot) return;

    chrome.storage.local.set({
      attendanceCopilot: {
        records: [],
        settings: {
          activeWindow: "semester",
          windows: {
            internal1: { label: "Internal 1", start: "", end: "", target: 80 },
            internal2: { label: "Internal 2", start: "", end: "", target: 80 },
            semester: { label: "Semester", start: "", end: "", target: 75 }
          },
          holidays: [],
          specialDays: {},
          timetable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => ({
            day,
            slots: Array.from({ length: 7 }, (_, index) => ({ hour: index + 1, subject: "" }))
          }))
        }
      }
    });
  });
});