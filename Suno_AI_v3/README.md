# Suno Tracklist Text Archiver for Microsoft Edge

Manifest V3 extension that:

- scans the active Suno tab for valid track rows,
- auto-scrolls the track-list container to load additional rows,
- deduplicates rows by `data-clip-id`,
- extracts rendered metadata and optional row `innerHTML`,
- writes one aggregate newline-delimited `.txt` archive file,
- saves the archive into a chosen Downloads subfolder.

## Files

- `manifest.json`
- `background.js`
- `content.js`
- `popup.html`
- `popup.css`
- `popup.js`

## Load in Edge

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Select **Load unpacked**
4. Choose this folder

## Use

1. Open a Suno page containing the track list.
2. Open the extension popup.
3. Set the Downloads subfolder and archive filename prefix.
4. Click **Auto-scroll and archive text**.

## Output format

The extension writes a single `.txt` file. Each track block is separated by blank lines and uses `field: value` lines.

Example shape:

```text


track 1 name: Example Track
track 1 clip id: 1234...
track 1 prompt: ...
track 1 row text: ...
track 1 innerhtml: ...


track 2 name: Another Track
track 2 clip id: 5678...
```

## Notes

- Track rows are anchored on `[data-testid="song-row"][data-clip-id]`.
- Prompt extraction prefers the row-local `title` attribute from the small prompt/style text block.
- The archive is text, not JSON.
- `innerHTML` can be disabled from the popup if the archive becomes too large.
