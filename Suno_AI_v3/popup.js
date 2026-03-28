const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(message) {
  statusEl.textContent = message;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error("No active tab.");
  return tabs[0];
}

async function loadOptions() {
  const defaults = {
    subfolder: "SunoExports",
    filenamePrefix: "suno_track_archive",
    maxScrollPasses: 40,
    idleMs: 1200,
    includeInnerHtml: true
  };
  const data = await chrome.storage.local.get(defaults);
  $("subfolder").value = data.subfolder;
  $("filenamePrefix").value = data.filenamePrefix;
  $("maxScrollPasses").value = data.maxScrollPasses;
  $("idleMs").value = data.idleMs;
  $("includeInnerHtml").checked = data.includeInnerHtml;
}

async function saveOptions() {
  const options = {
    subfolder: $("subfolder").value.trim() || "SunoExports",
    filenamePrefix: $("filenamePrefix").value.trim() || "suno_track_archive",
    maxScrollPasses: Number($("maxScrollPasses").value || 40),
    idleMs: Number($("idleMs").value || 1200),
    includeInnerHtml: $("includeInnerHtml").checked
  };
  await chrome.storage.local.set(options);
  return options;
}

async function sendToTab(type, payload = {}) {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

$("scanBtn").addEventListener("click", async () => {
  try {
    const options = await saveOptions();
    setStatus("Scanning current tab...");
    const result = await sendToTab("SUNO_SCAN_ONLY", { options });
    setStatus(JSON.stringify(result, null, 2));
  } catch (error) {
    setStatus(`Scan failed: ${error.message}`);
  }
});

$("runBtn").addEventListener("click", async () => {
  try {
    const options = await saveOptions();
    setStatus("Running auto-scroll archival...");
    const tab = await getActiveTab();
    const response = await chrome.runtime.sendMessage({
      type: "START_TRACKLIST_ARCHIVE",
      tabId: tab.id,
      options
    });
    setStatus(JSON.stringify(response, null, 2));
  } catch (error) {
    setStatus(`Archive failed: ${error.message}`);
  }
});

loadOptions().catch((e) => setStatus(`Init failed: ${e.message}`));
