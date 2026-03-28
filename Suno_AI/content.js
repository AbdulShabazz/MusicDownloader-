(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(input) {
    return String(input || "").replace(/\s+/g, " ").trim();
  }

  function getTrackRows() {
    return [...document.querySelectorAll('[data-testid="song-row"][data-clip-id]')];
  }

  function getGrid() {
    return document.querySelector('.react-aria-GridList[role="grid"]');
  }

  function findScrollableAncestor(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      const style = getComputedStyle(cur);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function getPromptNode(row) {
    return [...row.querySelectorAll('div[title]')].find((el) => {
      const cls = String(el.className || '');
      return cls.includes('text-xs') && cls.includes('text-foreground-primary');
    }) || null;
  }

  function extractTrackFromRow(row, ordinal) {
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
      pageUrl: location.href
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

  async function autoScrollTrackList(options) {
    const grid = getGrid();
    const scroller = grid ? findScrollableAncestor(grid) : (document.scrollingElement || document.documentElement);
    const maxScrollPasses = Math.max(1, Number(options?.maxScrollPasses || 40));
    const idleMs = Math.max(250, Number(options?.idleMs || 1200));

    let lastCount = 0;
    let stablePasses = 0;
    let pass = 0;

    while (pass < maxScrollPasses) {
      pass += 1;
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(idleMs);

      const count = getTrackRows().length;
      if (count <= lastCount) stablePasses += 1;
      else stablePasses = 0;

      lastCount = count;
      if (stablePasses >= 2) break;
    }

    scroller.scrollTop = 0;
    await sleep(150);

    return {
      ...scanRowsOnly(),
      autoScroll: {
        passesCompleted: pass,
        finalTrackCount: getTrackRows().length
      }
    };
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

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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
    await sleep(150);
    dispatchClick(button);
    await sleep(350);
  }

  function getOpenMenuCandidates() {
    return [
      ...document.querySelectorAll('[role="menuitem"]'),
      ...document.querySelectorAll('button'),
      ...document.querySelectorAll('[data-rac] [tabindex]')
    ];
  }

  function findDownloadMenuItem() {
    return getOpenMenuCandidates().find((el) => {
      if (!isElementVisible(el)) return false;
      const text = normalizeText(el.textContent);
      return /^download$/i.test(text) || /download/i.test(text);
    }) || null;
  }

  async function triggerNativeDownload(clipId) {
    const row = getRowByClipId(clipId);
    if (!row) throw new Error(`Song row not found for clip ${clipId}`);

    await openRowMenu(row);
    const item = findDownloadMenuItem();
    if (!item) throw new Error('Download menu item not found in open menu.');
    dispatchClick(item);
    await sleep(700);

    return { ok: true, clipId };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === 'SUNO_SCAN_ONLY') {
        sendResponse(scanRowsOnly());
        return;
      }
      if (message.type === 'SUNO_AUTOSCROLL_SCAN') {
        sendResponse(await autoScrollTrackList(message.options || {}));
        return;
      }
      if (message.type === 'SUNO_TRIGGER_NATIVE_DOWNLOAD') {
        sendResponse(await triggerNativeDownload(message.clipId));
        return;
      }
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message, stack: error.stack });
    });
    return true;
  });
})();
