# Suno Native Batch Downloader for Microsoft Edge

Manifest V3 extension that:

- scans the active Suno tab for rendered song rows,
- auto-scrolls the inner track list to trigger lazy loading,
- extracts row metadata using stable row-local selectors,
- opens each row's context menu,
- User invokes Suno's native **Download** action,
- renames the resulting browser download into a chosen subfolder under Downloads,
- writes a `.metadata.json` sidecar per track.

## Selector model

Primary row selector:

- `[data-testid="song-row"][data-clip-id]`

Row-local context menu selector:

- `button[data-context-menu-trigger="true"][aria-label="More menu contents"]`

## Load in Edge

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Use

1. Open a logged-in Suno page where tracks are visibly loaded.
2. Open the extension popup.
3. Enter a Downloads subfolder such as `SunoExports/Session_2026_03_28`.
4. Click **Scan, auto-scroll, download**.

## Notes

- This version prefers Suno's native Download menu item rather than fetching and transcoding media.
- Downloads are processed strictly serially so each native browser download can be correlated back to one row.
- The extension renames downloads when the browser exposes the download event to `chrome.downloads.onDeterminingFilename`.
- Prompt extraction prefers the prompt container's `title` attribute.
- The sidecar JSON is the authoritative metadata output.

## Known limits

- If Suno changes row markup, menu labels, or the native download flow, selectors in `content.js` may need adjustment.
- Some site-initiated downloads may not expose enough filename information until the browser download starts.
- If Edge is configured to always ask where to save downloads, that browser setting can interfere with unattended batch behavior.
