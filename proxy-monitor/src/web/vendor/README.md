# vendor/ — Bundled External Dependencies

This directory contains local copies of third-party libraries and fonts that were
previously loaded from external CDNs (jsdelivr.net, fonts.googleapis.com).

**Why:** Home Assistant addons should work fully offline. External CDN dependencies
break the dashboard when the network is unavailable.

## Contents

### JavaScript Libraries

| File | Source | Version |
|------|--------|---------|
| `chart.umd.min.js` | [Chart.js](https://www.chartjs.org/) | 4.4.3 |
| `chartjs-adapter-date-fns.bundle.min.js` | [chartjs-adapter-date-fns](https://github.com/chartjs/chartjs-adapter-date-fns) | 3.0.0 |

### Fonts

| File | Source |
|------|--------|
| `fonts/inter-latin.woff2` | [Google Fonts — Inter](https://fonts.google.com/specimen/Inter) |
| `fonts/inter-latin-ext.woff2` | Same, latin-ext unicode range |
| `fonts/inter-cyrillic.woff2` | Same, cyrillic unicode range |
| `fonts/inter-cyrillic-ext.woff2` | Same, cyrillic-ext unicode range |

Font subsets use `unicode-range` in CSS so the browser only downloads what's needed.

## How to Update

### Chart.js / Adapter

1. Download the new version:
   - `https://cdn.jsdelivr.net/npm/chart.js@<VERSION>/dist/chart.umd.min.js`
   - `https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@<VERSION>/dist/chartjs-adapter-date-fns.bundle.min.js`
2. Replace the corresponding files in this directory.
3. Update the version in the table above.

### Inter Font

1. Open `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap`
   in a **modern browser** (the response must contain woff2 URLs, not ttf).
2. Copy the woff2 URLs for the needed subsets (latin, latin-ext, cyrillic, cyrillic-ext).
3. Download each file and replace the corresponding file in `fonts/`.
4. If the URL structure or unicode-range values changed, update `@font-face` blocks
   in `css/vars.css` accordingly.

## References

- Scripts are loaded in `index.html`
- Font faces are declared in `css/vars.css`
