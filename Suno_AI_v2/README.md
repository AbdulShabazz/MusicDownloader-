# Suno Hover WAV Downloader for Microsoft Edge

Manifest V3 Edge extension that:

- watches valid Suno track rows,
- on hover extracts row metadata and caches the row innerHTML,
- opens the row context menu,
- attempts to click the WAV download option,
- renames the resulting download into a user-defined Downloads subfolder,
- writes a `.metadata.json` sidecar per track,
- suppresses duplicate downloads using a persistent cache keyed by `data-clip-id`.

## Load in Edge

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Use

1. Open a Suno page with visible song rows.
2. Open the extension popup.
3. Set the Downloads subfolder and hover delay.
4. Click **Enable hover mode**.
5. Move the pointer over any valid track row.
6. The extension will skip rows already cached as downloaded.

## Notes

- Duplicate prevention is persistent across sessions via `chrome.storage.local`.
- Hover mode does not auto-scroll or batch scan.
- WAV menu text is matched heuristically from the open context menu. If Suno changes that label, menu matching may need adjustment.
- The cache can be cleared from the popup.


UI update:
- Popup includes a Reset button that clears the status log and releases any active runtime reservation.
- Status panel appends events in chronological order with the latest entry at the bottom.
