(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const state = {
    hoverModeEnabled: false,
    hoverDelayMs: 450,
    activeClipId: null,
    rowListenersBound: false,
    observer: null
  };

  function normalizeText(input) {
    return String(input || "").replace(/\s+/g, " ").trim();
  }

  function getTrackRows() {
    return [...document.querySelectorAll('[data-testid="song-row"][data-clip-id]')];
  }

  function getPromptNode(row) {
    return [...row.querySelectorAll('div[title]')].find((el) => {
      const cls = String(el.className || '');
      return cls.includes('text-xs') && cls.includes('text-foreground-primary');
    }) || null;
  }

  function getRowByClipId(clipId) {
    return document.querySelector(`[data-testid="song-row"][data-clip-id="${CSS.escape(clipId)}"]`);
  }

  function getRowMenuButton(row) {
    return row?.querySelector('button[data-context-menu-trigger="true"][aria-label="More menu contents"]')
      || row?.querySelector('button[data-context-menu-trigger="true"]')
      || [...(row?.querySelectorAll('button') || [])].find((b) => /more menu contents/i.test(b.getAttribute('aria-label') || ''))
      || null;
  }

  function extractTrackFromRow(row, ordinal = null) {
    const clipId = row.getAttribute('data-clip-id') || null;
    const titleLink = row.querySelector('a[href^="/song/"]');
    const userLink = row.querySelector('a[href^="/@"]');
    const playButton = row.querySelector('[data-testid="song-row-play-button"]');
    const promptNode = getPromptNode(row);
    const durationNode = [...(playButton?.querySelectorAll('span') || [])].find((el) => /^\d+:\d{2}$/.test(normalizeText(el.textContent)));

    return {
      id: clipId,
      ordinal,
      title: normalizeText(titleLink?.textContent) || null,
      prompt: normalizeText(promptNode?.getAttribute('title') || promptNode?.textContent) || null,
      user: normalizeText(userLink?.textContent) || null,
      duration: normalizeText(durationNode?.textContent) || null,
      songPath: titleLink?.getAttribute('href') || null,
      songUrl: titleLink?.href || null,
      pageUrl: location.href,
      rowInnerHTML: row.innerHTML
    };
  }

  function scanRowsOnly() {
    const rows = getTrackRows();
    return {
      pageUrl: location.href,
      title: document.title,
      count: rows.length,
      tracks: rows.map((row, index) => extractTrackFromRow(row, index + 1))
    };
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function dispatchClick(el) {
    const events = ['pointerdown', 'mousedown', 'mouseup', 'click'];
    for (const type of events) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function openRowMenu(row) {
    const button = getRowMenuButton(row);
    if (!button) throw new Error('Row context menu button not found.');
    row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    await sleep(125);
    dispatchClick(button);
    await sleep(300);
  }

  function getOpenMenuCandidates() {
    return [
      ...document.querySelectorAll('[role="menuitem"]'),
      ...document.querySelectorAll('[role="menu"] [tabindex]'),
      ...document.querySelectorAll('[data-rac] [tabindex]'),
      ...document.querySelectorAll('button')
    ].filter((el) => isElementVisible(el));
  }

  function scoreMenuCandidate(el) {
    const text = normalizeText(el.textContent).toLowerCase();
    let score = 0;
    if (text.includes('wav')) score += 10;
    if (text.includes('download')) score += 5;
    if (text.includes('audio')) score += 4;
    if (/\bfile\b/.test(text)) score += 1;
    return score;
  }

  function findWavDownloadMenuItem() {
    const candidates = getOpenMenuCandidates()
      .map((el) => ({ el, score: scoreMenuCandidate(el), text: normalizeText(el.textContent) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

    return candidates[0]?.el || null;
  }

  function closeOpenMenus() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
  }

  async function triggerNativeWavDownload(clipId) {
    const row = getRowByClipId(clipId);
    if (!row) throw new Error(`Song row not found for clip ${clipId}`);

    await openRowMenu(row);
    const menuItem = findWavDownloadMenuItem();
    if (!menuItem) {
      closeOpenMenus();
      throw new Error('WAV download menu item not found in open menu.');
    }

    const menuText = normalizeText(menuItem.textContent);
    dispatchClick(menuItem);
    await sleep(700);
    return { ok: true, clipId, menuText };
  }

  async function handleHoverRow(row) {
    const track = extractTrackFromRow(row, null);
    if (!track.id) return { ok: false, skipped: true, reason: 'missing_clip_id' };
    if (!state.hoverModeEnabled) return { ok: false, skipped: true, reason: 'hover_mode_disabled' };
    if (state.activeClipId === track.id) return { ok: false, skipped: true, reason: 'already_processing' };

    state.activeClipId = track.id;
    try {
      await sleep(state.hoverDelayMs);
      const currentRow = getRowByClipId(track.id);
      if (!currentRow || !currentRow.matches(':hover')) {
        return { ok: false, skipped: true, reason: 'hover_cancelled' };
      }

      const reservation = await chrome.runtime.sendMessage({
        type: 'RESERVE_TRACK_FOR_DOWNLOAD',
        track
      });

      if (!reservation?.ok) {
        return { ok: false, skipped: true, reason: reservation?.reason || 'reservation_failed', trackId: track.id };
      }

      try {
        const trigger = await triggerNativeWavDownload(track.id);
        const completion = await chrome.runtime.sendMessage({
          type: 'FINALIZE_RESERVED_TRACK',
          clipId: track.id,
          menuText: trigger.menuText
        });
        return completion;
      } catch (error) {
        await chrome.runtime.sendMessage({
          type: 'RELEASE_RESERVED_TRACK',
          clipId: track.id,
          reason: error.message
        });
        throw error;
      }
    } finally {
      state.activeClipId = null;
    }
  }

  function bindRow(row) {
    if (!row || row.dataset.sunoHoverBound === '1') return;
    row.dataset.sunoHoverBound = '1';
    row.addEventListener('mouseenter', () => {
      handleHoverRow(row).catch((error) => {
        console.warn('Suno hover download failed:', error);
      });
    });
  }

  function bindRows() {
    getTrackRows().forEach(bindRow);
  }

  function ensureObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver(() => {
      if (state.hoverModeEnabled) bindRows();
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function setHoverModeEnabled(enabled, options = {}) {
    state.hoverModeEnabled = Boolean(enabled);
    state.hoverDelayMs = Math.max(0, Number(options.hoverDelayMs || 450));
    if (state.hoverModeEnabled) {
      bindRows();
      ensureObserver();
    }
    return {
      ok: true,
      enabled: state.hoverModeEnabled,
      hoverDelayMs: state.hoverDelayMs,
      boundRows: getTrackRows().filter((row) => row.dataset.sunoHoverBound === '1').length
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === 'SUNO_SCAN_ONLY') {
        sendResponse(scanRowsOnly());
        return;
      }
      if (message.type === 'SUNO_SET_HOVER_MODE') {
        sendResponse(await setHoverModeEnabled(message.enabled, message.options || {}));
        return;
      }
      if (message.type === 'SUNO_TRIGGER_NATIVE_WAV_DOWNLOAD') {
        sendResponse(await triggerNativeWavDownload(message.clipId));
        return;
      }
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message, stack: error.stack });
    });
    return true;
  });
})();
