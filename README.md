# LabelLens reference-inspired frontend

This is a responsive Flask template/static frontend inspired by the supplied Food Scanner & Product Checker reference. It uses a pastel pink, green and yellow palette and includes image upload, camera capture on supported devices, drag-and-drop, preview/removal, product name, API loading/error states, Green/Yellow/Orange/Red ingredient labels, searchable/filterable ingredient details, browser-local scan history, dark mode, share summary and JSON report download.

## Install into your existing Flask project
1. Back up your current `templates` and `static` folders.
2. Copy `templates/index.html` into your project's `templates/index.html`.
3. Copy `static/style.css` and `static/app.js` into your project's `static` folder.
4. Keep your existing `app.py`, model `.pkl`, ingredient database JSON and OCR setup. This frontend expects your Flask server to expose `POST /analyze`, accepting the image under the multipart field name `image` and returning JSON with an `ingredients` array. Each ingredient should have `name` and optionally `label`, `status`, and `reason`.
5. Run your existing app, for example `python app.py`, and refresh the page with `Ctrl+F5`.

## Important
- “Take photo” uses the device camera chooser where supported; on desktop, the browser may offer a file chooser instead.
- Scan history and theme preference are stored in the current browser's local storage. They are not sent to a database and may disappear if browser storage is cleared.
- The app colors reflect your model's labels, not independently verified food safety. OCR and model predictions can be wrong. Red is displayed as a model-assigned high-concern label, not a medical conclusion.
- If your `/analyze` endpoint uses a different response schema, adapt `renderReport()` and `labelFrom()` in `static/app.js` to match it.
