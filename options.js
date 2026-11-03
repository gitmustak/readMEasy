const DEFAULTS = { translate: true, font: true };

chrome.storage.sync.get(DEFAULTS).then((settings) => {
  for (const key of Object.keys(DEFAULTS)) {
    const box = document.getElementById(key);
    box.checked = settings[key];
    box.addEventListener("change", () => chrome.storage.sync.set({ [key]: box.checked }));
  }
});
