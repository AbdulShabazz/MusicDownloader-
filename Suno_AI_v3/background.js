const DEFAULTS = {
  subfolder: 'SunoExports',
  filenamePrefix: 'suno_track_archive',
  maxScrollPasses: 40,
  idleMs: 1200,
  includeInnerHtml: true
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(DEFAULTS);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_TRACKLIST_ARCHIVE') {
    runTracklistArchive(message.tabId, message.options)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message, stack: error.stack }));
    return true;
  }
});

async function runTracklistArchive(tabId, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const scan = await chrome.tabs.sendMessage(tabId, {
    type: 'SUNO_AUTOSCROLL_ARCHIVE_SCAN',
    options: opts
  });

  if (scan?.error || scan?.ok === false) {
    throw new Error(scan?.error || 'Tracklist archival scan failed.');
  }

  const archiveText = buildArchiveText(scan);
  const subfolder = sanitizePath(opts.subfolder || 'SunoExports');
  const prefix = sanitizeFilename(opts.filenamePrefix || 'suno_track_archive').slice(0, 80) || 'suno_track_archive';
  const stamp = makeTimestamp();
  const filename = `${subfolder}/${prefix}_${stamp}.txt`;
  const blob = new Blob([archiveText], { type: 'text/plain' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
    await waitForDownloadCompletion(downloadId);

    return {
      ok: true,
      pageUrl: scan.pageUrl,
      pageTitle: scan.pageTitle,
      archivedTracks: scan.count,
      autoScroll: scan.autoScroll,
      filename,
      downloadId
    };
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }
}

function buildArchiveText(scan) {
  const lines = [];
  const tracks = Array.isArray(scan.tracks) ? scan.tracks : [];

  lines.push(`page title: ${singleLine(scan.pageTitle)}`);
  lines.push(`page url: ${singleLine(scan.pageUrl)}`);
  lines.push(`archived at: ${new Date().toISOString()}`);
  lines.push(`track count: ${tracks.length}`);

  for (const track of tracks) {
    lines.push('');
    lines.push('');
    lines.push(`track ${track.ordinal} name: ${singleLine(track.title)}`);
    lines.push(`track ${track.ordinal} clip id: ${singleLine(track.id)}`);
    lines.push(`track ${track.ordinal} user: ${singleLine(track.user)}`);
    lines.push(`track ${track.ordinal} duration: ${singleLine(track.duration)}`);
    lines.push(`track ${track.ordinal} song url: ${singleLine(track.songUrl)}`);
    lines.push(`track ${track.ordinal} song path: ${singleLine(track.songPath)}`);
    lines.push(`track ${track.ordinal} user path: ${singleLine(track.userPath)}`);
    lines.push(`track ${track.ordinal} image url: ${singleLine(track.imageUrl)}`);
    lines.push(`track ${track.ordinal} page url: ${singleLine(track.pageUrl)}`);
    lines.push(`track ${track.ordinal} tags: ${singleLine((track.tags || []).join(' | '))}`);
    lines.push(`track ${track.ordinal} prompt: ${multilineValue(track.prompt)}`);
    lines.push(`track ${track.ordinal} row text: ${multilineValue(track.rowText)}`);
    if (track.rowInnerHTML) {
      lines.push(`track ${track.ordinal} innerhtml: ${multilineValue(track.rowInnerHTML)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function singleLine(value) {
  return String(value || '').replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function multilineValue(value) {
  const normalized = String(value || '').replace(/\r/g, ' ').replace(/\n/g, ' ');
  return normalized.trim();
}

function makeTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

function waitForDownloadCompletion(downloadId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error(`Archive download ${downloadId} timed out.`));
    }, 120000);

    function listener(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        clearTimeout(timeout);
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      } else if (delta.error?.current) {
        clearTimeout(timeout);
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error(`Archive download ${downloadId} failed: ${delta.error.current}`));
      }
    }

    chrome.downloads.onChanged.addListener(listener);
  });
}

function sanitizePath(path) {
  return path
    .replace(/^[\\/]+|[\\/]+$/g, '')
    .split(/[\\/]+/)
    .map((part) => sanitizeFilename(part).slice(0, 80) || 'untitled')
    .join('/');
}

function sanitizeFilename(input) {
  return String(input || '')
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}
