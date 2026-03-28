const DEFAULTS = {
  subfolder: 'SunoExports',
  hoverDelayMs: 450,
  includePromptInFilename: true,
  downloadCache: {},
  statusLog: []
};

const STATUS_LOG_LIMIT = 250;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(DEFAULTS);
});

let activeDownload = null;

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!activeDownload || activeDownload.resolved) return;

  const extension = inferExtension(item);
  const slug = makeTrackSlug(activeDownload.track, activeDownload.options);
  const subfolder = sanitizePath(activeDownload.options.subfolder || 'SunoExports');
  const targetFilename = `${subfolder}/${slug}.${extension}`;

  activeDownload.downloadId = item.id;
  activeDownload.suggestedFilename = targetFilename;
  void pushStatus(`Renaming native download for ${activeDownload.track?.title || activeDownload.track?.id || 'track'} to:
${targetFilename}`);
  suggest({ filename: targetFilename, conflictAction: 'uniquify' });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!activeDownload || activeDownload.resolved) return;
  if (delta.id !== activeDownload.downloadId) return;

  if (delta.state?.current === 'complete') {
    activeDownload.resolved = true;
    void pushStatus(`Download completed for ${activeDownload.track?.title || activeDownload.track?.id || 'track'}.`);
    activeDownload.resolve({
      downloadId: activeDownload.downloadId,
      filename: activeDownload.suggestedFilename
    });
    activeDownload = null;
  } else if (delta.error?.current) {
    activeDownload.resolved = true;
    void pushStatus(`Download failed for ${activeDownload.track?.title || activeDownload.track?.id || 'track'}: ${delta.error.current}`);
    activeDownload.reject(new Error(`Download failed: ${delta.error.current}`));
    activeDownload = null;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'RESERVE_TRACK_FOR_DOWNLOAD') {
    reserveTrackForDownload(message.track)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, reason: error.message }));
    return true;
  }

  if (message.type === 'FINALIZE_RESERVED_TRACK') {
    finalizeReservedTrack(message.clipId, message.menuText)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'RELEASE_RESERVED_TRACK') {
    releaseReservedTrack(message.clipId, message.reason)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_CACHE_STATS') {
    getCacheStats().then(sendResponse);
    return true;
  }

  if (message.type === 'CLEAR_DOWNLOAD_CACHE') {
    clearDownloadCache().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_STATUS_LOG') {
    getStatusLog().then(sendResponse);
    return true;
  }

  if (message.type === 'RESET_RUNTIME_STATE') {
    resetRuntimeState().then(sendResponse);
    return true;
  }
});

async function pushStatus(message) {
  const timestamp = new Date().toISOString();
  const store = await chrome.storage.local.get({ statusLog: [] });
  const entries = [...(store.statusLog || []), { timestamp, message: String(message || '') }].slice(-STATUS_LOG_LIMIT);
  await chrome.storage.local.set({ statusLog: entries });
  try {
    await chrome.runtime.sendMessage({ type: 'STATUS_LOG', timestamp, message: String(message || '') });
  } catch {
  }
  return { timestamp, message: String(message || '') };
}

async function getStatusLog() {
  const store = await chrome.storage.local.get({ statusLog: [] });
  return { ok: true, entries: store.statusLog || [] };
}

async function reserveTrackForDownload(track) {
  if (!track?.id) return { ok: false, reason: 'missing_clip_id' };
  const store = await chrome.storage.local.get(DEFAULTS);
  const cache = store.downloadCache || {};

  if (cache[track.id]?.status === 'complete') {
    await pushStatus(`Skipped duplicate cached track: ${track.title || track.id}`);
    return { ok: false, reason: 'duplicate_cached', trackId: track.id };
  }

  if (activeDownload && !activeDownload.resolved) {
    if (activeDownload.track?.id === track.id) {
      await pushStatus(`Skipped already-processing track: ${track.title || track.id}`);
      return { ok: false, reason: 'already_processing', trackId: track.id };
    }
    await pushStatus(`Deferred ${track.title || track.id}: another download is active.`);
    return { ok: false, reason: 'another_download_active', activeClipId: activeDownload.track?.id || null };
  }

  const options = {
    subfolder: store.subfolder || DEFAULTS.subfolder,
    hoverDelayMs: Number(store.hoverDelayMs || DEFAULTS.hoverDelayMs),
    includePromptInFilename: store.includePromptInFilename !== false
  };

  await chrome.storage.local.set({
    downloadCache: {
      ...cache,
      [track.id]: {
        status: 'pending',
        reservedAt: new Date().toISOString(),
        title: track.title || null,
        prompt: track.prompt || null,
        user: track.user || null
      }
    }
  });

  waitForNextDownload(track, options);
  await pushStatus(`Reserved track for native WAV download: ${track.title || track.id}`);
  return { ok: true, trackId: track.id };
}

async function finalizeReservedTrack(clipId, menuText) {
  if (!activeDownload || activeDownload.track?.id !== clipId) {
    throw new Error('No matching reserved download is active.');
  }

  const downloadResult = await activeDownload.promise;
  const jsonFilename = await createMetadataSidecar(downloadResult.filename, {
    ...activeDownload.track,
    menuText: menuText || null
  });

  const store = await chrome.storage.local.get(DEFAULTS);
  const cache = store.downloadCache || {};
  cache[clipId] = {
    ...(cache[clipId] || {}),
    status: 'complete',
    completedAt: new Date().toISOString(),
    filename: downloadResult.filename,
    metadataFilename: jsonFilename,
    title: activeDownload.track.title || null,
    prompt: activeDownload.track.prompt || null,
    user: activeDownload.track.user || null
  };
  await chrome.storage.local.set({ downloadCache: cache });
  await pushStatus(`Cached completed download: ${activeDownload.track.title || clipId}`);

  return {
    ok: true,
    clipId,
    filename: downloadResult.filename,
    jsonFilename,
    menuText: menuText || null,
    cached: true
  };
}

async function releaseReservedTrack(clipId, reason = 'released') {
  const store = await chrome.storage.local.get(DEFAULTS);
  const cache = store.downloadCache || {};
  if (cache[clipId]?.status === 'pending') delete cache[clipId];
  await chrome.storage.local.set({ downloadCache: cache });

  if (activeDownload?.track?.id === clipId && !activeDownload.resolved) {
    activeDownload.resolved = true;
    activeDownload = null;
  }

  await pushStatus(`Released reserved track ${clipId}: ${reason}`);
  return { ok: true, clipId, released: true, reason };
}

async function getCacheStats() {
  const store = await chrome.storage.local.get(DEFAULTS);
  const cache = store.downloadCache || {};
  const entries = Object.entries(cache);
  const result = {
    ok: true,
    totalCached: entries.length,
    completed: entries.filter(([, value]) => value.status === 'complete').length,
    pending: entries.filter(([, value]) => value.status === 'pending').length
  };
  await pushStatus(`Cache stats requested. Total=${result.totalCached}, completed=${result.completed}, pending=${result.pending}`);
  return result;
}

async function clearDownloadCache() {
  await chrome.storage.local.set({ downloadCache: {} });
  await pushStatus('Download cache cleared.');
  return { ok: true, cleared: true };
}

async function resetRuntimeState() {
  const releasedClipId = activeDownload?.track?.id || null;
  if (activeDownload && !activeDownload.resolved) {
    activeDownload.resolved = true;
    activeDownload = null;
  }
  await chrome.storage.local.set({ statusLog: [] });
  return { ok: true, reset: true, releasedActiveClipId: releasedClipId };
}

function waitForNextDownload(track, options) {
  if (activeDownload && !activeDownload.resolved) {
    throw new Error('A prior download is still pending.');
  }

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const timeout = setTimeout(() => {
    if (activeDownload && activeDownload.track?.id === track.id && !activeDownload.resolved) {
      activeDownload.resolved = true;
      activeDownload = null;
    }
    rejectPromise(new Error(`Timed out waiting for download to start for ${track.title || track.id}`));
  }, 120000);

  activeDownload = {
    track,
    options,
    promise,
    resolve: (value) => {
      clearTimeout(timeout);
      resolvePromise(value);
    },
    reject: (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    },
    resolved: false,
    downloadId: null,
    suggestedFilename: null
  };

  return promise;
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
  return 'wav';
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

function makeTrackSlug(track, options) {
  const title = sanitizeFilename(track.title || track.id || 'track').slice(0, 80);
  const prompt = options.includePromptInFilename
    ? sanitizeFilename((track.prompt || '').slice(0, 80)).slice(0, 80)
    : '';
  return [title, prompt].filter(Boolean).join(' - ');
}
