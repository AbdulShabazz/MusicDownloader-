(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(input) {
    return String(input || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeMultilineText(input) {
    return String(input || '').replace(/\r/g, '').trim();
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

  function getDurationNode(row) {
    const playButton = row.querySelector('[data-testid="song-row-play-button"]');
    return [...(playButton?.querySelectorAll('span') || [])].find((el) => /^\d+:\d{2}$/.test(normalizeText(el.textContent))) || null;
  }

  function getImageUrl(row) {
    const img = row.querySelector('img[alt="Song Image"]');
    return img?.getAttribute('data-src') || img?.getAttribute('src') || null;
  }

  function getTagTexts(row) {
    const nodes = [...row.querySelectorAll('span[title]')];
    const values = nodes.map((el) => normalizeText(el.getAttribute('title'))).filter(Boolean);
    return [...new Set(values)];
  }

  function extractTrackFromRow(row, ordinal, options = {}) {
    const clipId = row.getAttribute('data-clip-id') || null;
    const titleLink = row.querySelector('a[href^="/song/"]');
    const userLink = row.querySelector('a[href^="/@"]');
    const promptNode = getPromptNode(row);
    const durationNode = getDurationNode(row);

    return {
      id: clipId,
      ordinal,
      title: normalizeText(titleLink?.textContent) || null,
      prompt: sanitizeMultilineText(promptNode?.getAttribute('title') || promptNode?.textContent) || null,
      user: normalizeText(userLink?.textContent) || null,
      userPath: userLink?.getAttribute('href') || null,
      duration: normalizeText(durationNode?.textContent) || null,
      songPath: titleLink?.getAttribute('href') || null,
      songUrl: titleLink?.href || null,
      imageUrl: getImageUrl(row),
      tags: getTagTexts(row),
      pageUrl: location.href,
      rowText: sanitizeMultilineText(row.textContent),
      rowInnerHTML: options.includeInnerHtml ? row.innerHTML : null
    };
  }

  function scanRowsOnly(options = {}) {
    const rows = getTrackRows();
    const seen = new Set();
    const tracks = [];

    for (const row of rows) {
      const clipId = row.getAttribute('data-clip-id') || null;
      if (!clipId || seen.has(clipId)) continue;
      seen.add(clipId);
      tracks.push(extractTrackFromRow(row, tracks.length + 1, options));
    }

    return {
      pageUrl: location.href,
      pageTitle: document.title,
      count: tracks.length,
      tracks
    };
  }

  async function autoScrollTrackList(options = {}) {
    const grid = getGrid();
    const scroller = grid ? findScrollableAncestor(grid) : (document.scrollingElement || document.documentElement);
    const maxScrollPasses = Math.max(1, Number(options.maxScrollPasses || 40));
    const idleMs = Math.max(250, Number(options.idleMs || 1200));
    const trackMap = new Map();

    let pass = 0;
    let stablePasses = 0;
    let lastCount = 0;

    while (pass < maxScrollPasses) {
      const rows = getTrackRows();
      for (const row of rows) {
        const clipId = row.getAttribute('data-clip-id') || null;
        if (!clipId || trackMap.has(clipId)) continue;
        trackMap.set(clipId, extractTrackFromRow(row, trackMap.size + 1, options));
      }

      const currentCount = trackMap.size;
      if (currentCount <= lastCount) stablePasses += 1;
      else stablePasses = 0;
      lastCount = currentCount;
      if (stablePasses >= 2) break;

      pass += 1;
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(idleMs);
    }

    scroller.scrollTop = 0;
    await sleep(150);

    const orderedTracks = [...trackMap.values()].map((track, index) => ({ ...track, ordinal: index + 1 }));

    return {
      pageUrl: location.href,
      pageTitle: document.title,
      count: orderedTracks.length,
      tracks: orderedTracks,
      autoScroll: {
        passesCompleted: pass,
        finalTrackCount: orderedTracks.length
      }
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === 'SUNO_SCAN_ONLY') {
        sendResponse(scanRowsOnly(message.options || {}));
        return;
      }
      if (message.type === 'SUNO_AUTOSCROLL_ARCHIVE_SCAN') {
        sendResponse(await autoScrollTrackList(message.options || {}));
        return;
      }
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message, stack: error.stack });
    });
    return true;
  });
})();
