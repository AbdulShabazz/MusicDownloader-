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
    /* Default settings are configured in background.js */
    subfolder: "SunoExports",
    maxScrollPasses: 40,
    idleMs: 1000,
    includePromptInFilename: false
  };
  const data = await chrome.storage.local.get(defaults);
  $("subfolder").value = data.subfolder;
  $("maxScrollPasses").value = data.maxScrollPasses;
  $("idleMs").value = data.idleMs;
  $("includePromptInFilename").checked = data.includePromptInFilename;
}

async function saveOptions() {
  const options = {
    subfolder: $("subfolder").value.trim() || "SunoExports",
    maxScrollPasses: Number($("maxScrollPasses").value || 40),
    idleMs: Number($("idleMs").value || 1200),
    includePromptInFilename: $("includePromptInFilename").checked
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

$("resumeBtn").addEventListener("click", async () => {
  try {
      const options = await saveOptions();
      setStatus("Resuming auto-scroll scan and native download automation...");
      const tab = await getActiveTab();
      const response = await chrome.runtime.sendMessage({
        type: "RESUME_NATIVE_BATCH_DOWNLOAD",
        tabId: tab.id,
        options
      });
      setStatus(JSON.stringify(response, null, 2));  
  } catch (error) {
    setStatus(`Resume failed: ${error.message}. Please scroll to item or page and try again.`);
  }
});

$("runBtn").addEventListener("click", async () => {
  try {
    const options = await saveOptions();
    setStatus("Running auto-scroll scan and native download automation...");
    const tab = await getActiveTab();
    const response = await chrome.runtime.sendMessage({
      type: "START_NATIVE_BATCH_DOWNLOAD",
      tabId: tab.id,
      options
    });
    setStatus(JSON.stringify(response, null, 2));
  } catch (error) {
    setStatus(`Download failed: ${error.message}`);
  }
});

loadOptions().catch((e) => setStatus(`Init failed: ${e.message}`));
