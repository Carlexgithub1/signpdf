# SignPDF

A minimalist, fully client-side PDF signing app. Open a PDF, draw or type a signature, place it anywhere on any page, and download the flattened signed PDF. Nothing is uploaded — all rendering and PDF writing happens in the browser.

![no build step](https://img.shields.io/badge/build-none-brightgreen) ![vanilla JS](https://img.shields.io/badge/stack-vanilla%20JS-f7df1e) ![offline](https://img.shields.io/badge/offline-ready-blue)

## Quick start

1. Open `index.html` in a modern browser (double-click works — no server required).
2. Drop a PDF onto the page, or click **Open PDF**.
3. Click **Add signature**, then **Draw** with a mouse/finger/stylus or switch to **Type**.
4. Drag the signature to position it, drag a corner handle to resize.
5. Click **Download signed PDF**.

Because `pdf-lib` and `pdf.js` are vendored in `vendor/`, the app works with no network connection. If those files are missing, it falls back to pinned CDN builds (which needs internet on first load).

## Features

- **Offline, no server:** plain HTML/CSS/JS; local vendor copies of the PDF engines.
- **Draw or type:** smooth freehand ink with adjustable thickness and three ink colors, or a typed signature with four font styles.
- **Place & resize:** drag anywhere on any page, aspect-locked corner resizing down to a small stamp (compact handles keep tiny signatures usable), duplicate/remove, arrow-key nudging.
- **All pages:** scroll through the whole document; pages render lazily (pdf.js) and signatures are stored as percentages of the page so they survive zoom and window resize.
- **Correct on rotated pages:** the exporter accounts for page `/Rotate` values (0°, 90°, 180°, 270°) and non-zero page origins.
- **Private:** the file never leaves the device.
- **Responsive:** usable on phones and tablets; larger touch targets for handles and tools.
- **Accessible:** keyboard focus states, focus-trapped dialog, labels, live status messages.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + O` | Open a PDF |
| `Ctrl/Cmd + S` | Download the signed PDF |
| `Esc` | Close the signature dialog / deselect a signature |
| `← ↑ → ↓` | Nudge the selected signature by 1 px (`Shift`: 10 px) |
| `Delete` / `Backspace` | Remove the selected signature |
| `Ctrl/Cmd + D` | Duplicate the selected signature |

## Project structure

```
index.html        UI shell (no inline logic)
styles.css        Minimalist design system, responsive layout
app.js            Viewer, signature capture, placement, export
vendor/
  pdf-lib.min.js        PDF writing (embed PNG, save)
  pdf.min.js            PDF rendering
  pdf.worker.min.js     pdf.js worker (falls back to main thread on file://)
```

## How it works

- **Rendering:** `pdf.js` renders each page into a canvas at the device pixel ratio. Pages are observed with `IntersectionObserver` and rendered only when near the viewport.
- **Signatures:** ink strokes are captured as normalized points and redrawn with quadratic smoothing; typed signatures are drawn to a canvas. Both are trimmed to their ink bounds and exported as transparent PNGs, so they look identical in the PDF without embedding fonts.
- **Placement:** overlays are DOM elements positioned in percentages of the page. Dragging/resizing updates those percentages; the exported PDF uses the same fractions converted to PDF points.
- **Export:** `pdf-lib` embeds each unique PNG once, draws it on the matching page (`rotate` matching the page rotation), and saves a new file named `<original>-signed.pdf`.

## Notes & limitations

- Encrypted or password-protected PDFs are not supported (pdf-lib cannot edit them).
- Files up to 120 MB are accepted; very large documents may be slow on low-memory devices.
- Typed signatures use system fonts, so the exact handwriting style can vary between operating systems.
- Signatures are flattened into the page content — this is a simple visual/cryptographic-signature replacement, not a certificate-based digital signature (PAdES/ICP-Brasil).

## Third-party licenses

- [pdf-lib](https://github.com/Hopding/pdf-lib) — MIT
- [pdf.js](https://github.com/mozilla/pdf.js) — Apache-2.0
