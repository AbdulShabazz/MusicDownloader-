const $ = (id) => document.getElementById(id);
const statusLogEl = $('statusLog');
let logEntries = [];

function formatTimestamp(isoString) {
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

function appendStatus(message, timestamp = new Date().toISOString()) {
  const entry = { timestamp, message: String(message || '') };
  logEntries.push(entry);

  const item = document.createElement('div');
  item.className = 'status-item';

  const time = document.createElement('div');
  time.className = 'status-time';
  time.textContent = formatTimestamp(entry.timestamp);

  const text = document.createElement('div');
  text.className = 'status-message';
  text.textContent = entry.message;

  item.appendChild(time);
  item.appendChild(text);
  statusLogEl.appendChild(item);
  statusLogEl.scrollTop = statusLogEl.scrollHeight;
}

function resetStatusLog() {
  logEntries = [];
  statusLogEl.replaceChildren();
}

function appendJsonStatus(label, value) {
  appendStatus(`${label}
${JSON.stringify(value, null, 2)}`);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error('No active tab.');
  return tabs[0];
}

async function loadOptions() {
  const defaults = {
    subfolder: 'SunoExports',
    hoverDelayMs: 450,
    includePromptInFilename: true
  };
  const data = await chrome.storage.local.get(defaults);
  $('subfolder').value = data.subfolder;
  $('hoverDelayMs').value = data.hoverDelayMs;
  $('includePromptInFilename').checked = data.includePromptInFilename;
}

async function saveOptions() {
  const options = {
    subfolder: $('subfolder').value.trim() || 'SunoExports',
    hoverDelayMs: Number($('hoverDelayMs').value || 450),
    includePromptInFilename: $('includePromptInFilename').checked
  };
  await chrome.storage.local.set(options);
  return options;
}

async function sendToTab(type, payload = {}) {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'STATUS_LOG') {
    appendStatus(message.message, message.timestamp);
  }
});

$('scanBtn').addEventListener('click', async () => {
  try {
    await saveOptions();
    appendStatus('Scanning current tab...');
    const result = await sendToTab('SUNO_SCAN_ONLY');
    appendJsonStatus('Scan result', result);
  } catch (error) {
    appendStatus(`Scan failed: ${error.message}`);
  }
});

$('enableBtn').addEventListener('click', async () => {
  try {
    const options = await saveOptions();
    appendStatus('Enabling hover WAV download mode...');
    const result = await sendToTab('SUNO_SET_HOVER_MODE', { enabled: true, options });
    appendJsonStatus('Hover mode enabled', result);
  } catch (error) {
    appendStatus(`Enable failed: ${error.message}`);
  }
});

$('disableBtn').addEventListener('click', async () => {
  try {
    appendStatus('Disabling hover WAV download mode...');
    const result = await sendToTab('SUNO_SET_HOVER_MODE', { enabled: false });
    appendJsonStatus('Hover mode disabled', result);
  } catch (error) {
    appendStatus(`Disable failed: ${error.message}`);
  }
});

$('statsBtn').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' });
    appendJsonStatus('Cache stats', result);
  } catch (error) {
    appendStatus(`Stats failed: ${error.message}`);
  }
});

$('clearCacheBtn').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CLEAR_DOWNLOAD_CACHE' });
    appendJsonStatus('Cache cleared', result);
  } catch (error) {
    appendStatus(`Clear cache failed: ${error.message}`);
  }
});

$('resetBtn').addEventListener('click', async () => {
  try {
    appendStatus('Resetting runtime state and clearing status log...');
    try {
      const tabResult = await sendToTab('SUNO_SET_HOVER_MODE', { enabled: false });
      appendJsonStatus('Hover mode disabled for reset', tabResult);
    } catch (error) {
      appendStatus(`Tab reset note: ${error.message}`);
    }
    const result = await chrome.runtime.sendMessage({ type: 'RESET_RUNTIME_STATE' });
    resetStatusLog();
    appendJsonStatus('Reset complete', result);
  } catch (error) {
    appendStatus(`Reset failed: ${error.message}`);
  }
});

async function loadExistingLog() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_STATUS_LOG' });
    resetStatusLog();
    for (const entry of result.entries || []) {
      appendStatus(entry.message, entry.timestamp);
    }
    if (!result.entries?.length) appendStatus('Idle.');
  } catch (error) {
    appendStatus(`Log load failed: ${error.message}`);
  }
}

Promise.all([loadOptions(), loadExistingLog()]).catch((error) => appendStatus(`Init failed: ${error.message}`));
