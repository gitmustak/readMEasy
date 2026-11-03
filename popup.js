const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(msg, isErr = false, isOk = false) {
  statusEl.textContent = msg;
  statusEl.className = isErr ? "err" : isOk ? "ok" : "";
}

async function translate(text, from) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" +
    `&sl=${from}&tl=en`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: text }),
  });
  if (!res.ok) throw new Error(`Translation failed (${res.status})`);
  const data = await res.json();
  return data[0].map((part) => part[0]).join("");
}

let toastTimer;
function showToast(msg) {
  const t = $("toast");
  t.firstElementChild.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1200);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

let tabId = null;
let selectedText = "";
let pending = null; // { lang, promise } — translation started before the click

function prefetch() {
  if (!selectedText) return;
  const lang = $("lang").value;
  const promise = translate(selectedText, lang);
  promise.catch(() => {}); // errors surface when the user clicks
  pending = { lang, promise };
}

async function inject(id) {
  await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] });
}

const send = (msg) => chrome.tabs.sendMessage(tabId, msg);

const PROMPT = "Select any text to translate";
let idleTimer;
const actionBtn = $("action");
const fontBtn = $("font");
let mode = "none"; // "none" | "translate" | "restore"

let settings = { translate: true, font: true };

function setMode(next) {
  mode = next;
  actionBtn.hidden = next === "none" || (next === "translate" && !settings.translate);
  actionBtn.textContent = next === "restore" ? "Restore original" : "Translate";
  actionBtn.classList.toggle("secondary", next === "restore");
  fontBtn.hidden = next !== "translate" || !settings.font;
}

async function init() {
  try {
    settings = await chrome.storage.sync.get(settings);
    tabId = (await activeTab()).id;
    await inject(tabId);
    const sel = await send({ type: "getSelection" });
    selectedText = (sel && sel.text) || "";
    if (selectedText) {
      setMode("translate");
      setStatus(
        settings.translate || settings.font ? "" : "Both options are turned off in Settings."
      );
      if (settings.translate) prefetch();
    } else if (sel && sel.translated) {
      setMode("restore");
      setStatus("This page has translated text.", false, true);
    } else {
      setMode("none");
      setStatus(PROMPT);
    }
  } catch (e) {
    setMode("none");
    setStatus("Can't run on this page.", true);
  }
}

async function translateSelection() {
  actionBtn.disabled = true;
  try {
    if (!pending || pending.lang !== $("lang").value) prefetch();
    const out = await pending.promise.catch((e) => {
      pending = null; // allow a fresh attempt on the next click
      throw e;
    });
    await send({ type: "replace", text: out });
    setMode("restore");
    setStatus("");
    showToast("Translated ✓");
  } finally {
    actionBtn.disabled = false;
  }
}

async function restoreOriginal() {
  await send({ type: "restore" });
  setMode("none");
  setStatus("Original text restored.", false, true);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (mode === "none") setStatus(PROMPT);
  }, 1800);
}

fontBtn.addEventListener("click", async () => {
  fontBtn.disabled = true;
  try {
    const res = await send({ type: "font" });
    if (!res || !res.ok) throw new Error((res && res.error) || "Couldn't apply font");
    setMode("restore");
    setStatus("");
    showToast("Font changed ✓");
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    fontBtn.disabled = false;
  }
});

$("lang").value = localStorage.getItem("lang") || "bn";
$("lang").addEventListener("change", () => {
  localStorage.setItem("lang", $("lang").value);
  if (mode === "translate") prefetch();
});
actionBtn.addEventListener("click", async () => {
  try {
    await (mode === "restore" ? restoreOriginal() : translateSelection());
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
});

$("settings").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
