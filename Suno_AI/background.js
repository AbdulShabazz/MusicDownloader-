const DEFAULTS = {
  subfolder: 'SunoExports',
  maxScrollPasses: 40,
  idleMs: 1000,
  includePromptInFilename: false
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(DEFAULTS);
});

let activeRename = null;

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!activeRename || activeRename.resolved) return;

  const extension = inferExtension(item);
  const slug = makeTrackSlug(activeRename.track, activeRename.index, activeRename.options);
  const subfolder = sanitizePath(activeRename.options.subfolder || 'SunoExports');
  const targetFilename = `${subfolder}/${slug}.${extension}`;

  activeRename.downloadId = item.id;
  activeRename.suggestedFilename = targetFilename;
  suggest({ filename: targetFilename, conflictAction: 'uniquify' });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!activeRename || activeRename.resolved) return;
  if (delta.id !== activeRename.downloadId) return;

  if (delta.state?.current === 'complete') {
    activeRename.resolved = true;
    activeRename.resolve({
      downloadId: activeRename.downloadId,
      filename: activeRename.suggestedFilename
    });
    activeRename = null;
  } else if (delta.error?.current) {
    activeRename.resolved = true;
    activeRename.reject(new Error(`Download failed: ${delta.error.current}`));
    activeRename = null;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_NATIVE_BATCH_DOWNLOAD' || (message.type === 'RESUME_NATIVE_BATCH_DOWNLOAD')) {
    runNativeBatchDownload(message.tabId, message.options, message.type)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message, stack: error.stack }));
    return true;
  }
});

async function runNativeBatchDownload(tabId, options = {}, flags) {
  const opts = { ...DEFAULTS, ...options };
  const scan = await chrome.tabs.sendMessage(tabId, {
    type: 'SUNO_AUTOSCROLL_SCAN',
    options: opts,
    flags: flags
  });

  if (scan?.error) throw new Error(scan.error);

  const results = [];
  for (const [index, track] of scan.tracks.entries()) {
    try {
      const completionPromise = waitForNextDownload(track, index + 1, opts);
      const trigger = await chrome.tabs.sendMessage(tabId, {
        type: 'SUNO_TRIGGER_NATIVE_DOWNLOAD',
        clipId: track.id
      });

      if (trigger?.error || trigger?.ok === false) {
        cancelPendingRename();
        throw new Error(trigger?.error || 'Native download trigger failed.');
      }

      const downloadResult = await completionPromise;
      const jsonFilename = await createMetadataSidecar(downloadResult.filename, track);
      results.push({ ok: true, index: index + 1, clipId: track.id, title: track.title, filename: downloadResult.filename, jsonFilename });
    } catch (error) {
      cancelPendingRename();
      results.push({ ok: false, index: index + 1, clipId: track.id, title: track.title, error: error.message });
    }
  }

  return {
    ok: true,
    pageUrl: scan.pageUrl,
    discovered: scan.count,
    downloaded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    autoScroll: scan.autoScroll,
    results
  };
}

function waitForNextDownload(track, index, options) {
  if (activeRename && !activeRename.resolved) {
    throw new Error('A prior download is still pending.');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (activeRename && activeRename.track?.id === track.id && !activeRename.resolved) {
        activeRename.resolved = true;
        activeRename = null;
      }
      reject(new Error(`Timed out waiting for download to start for ${track.title || track.id}`));
    }, 120000);

    activeRename = {
      track,
      index,
      options,
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      resolved: false,
      downloadId: null,
      suggestedFilename: null
    };
  });
}

function cancelPendingRename() {
  if (activeRename && !activeRename.resolved) {
    activeRename.resolved = true;
    activeRename = null;
  }
}

async function createMetadataSidecar(downloadedFilename, track) {
  const base = downloadedFilename.replace(/\.[^.]+$/, '');
  const jsonFilename = `${base}.metadata.json`;
  const blob = new Blob([JSON.stringify({ ...track, exportedAt: new Date().toISOString(), downloadedAs: downloadedFilename }, null, 2)], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: jsonFilename,
      conflictAction: 'uniquify',
      saveAs: false
    });
    await waitForDownloadCompletion(downloadId);
    return jsonFilename;
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }
}

function waitForDownloadCompletion(downloadId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error(`Metadata sidecar download ${downloadId} timed out.`));
    }, 60000);

    function listener(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        clearTimeout(timeout);
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      } else if (delta.error?.current) {
        clearTimeout(timeout);
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error(`Metadata sidecar download ${downloadId} failed: ${delta.error.current}`));
      }
    }

    chrome.downloads.onChanged.addListener(listener);
  });
}

function inferExtension(item) {
  const fromFilename = (item.filename || '').match(/\.([A-Za-z0-9]+)$/)?.[1];
  if (fromFilename) return fromFilename.toLowerCase();
  const fromUrl = (item.finalUrl || item.url || '').match(/\.([A-Za-z0-9]+)(?:$|[?#])/i)?.[1];
  if (fromUrl) return fromUrl.toLowerCase();
  return 'bin';
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

function makeTrackSlug(track, index, options) {
  const prefix = ''; //String(index).padStart(3, '0');
  const title = sanitizeFilename(track.title || `track_${index}`).slice(0, 80);
  const prompt = options.includePromptInFilename
    ? sanitizeFilename((track.prompt || '').slice(0, 80)).slice(0, 80)
    : '';
  return [prefix, title, prompt].filter(Boolean).join(' - ');
}
