# pill-tracker
Track medication left before refill.

A small, static pill inventory for Saj. No backend, account, build step, package install, analytics or external runtime dependencies. The app starts empty. Medication details are entered by the person using it, not populated from private records.

## Use it

Add a medication, its current pill count and a tracking method. Optional strength text helps distinguish packs. Choose your own refill threshold and, optionally, a usual refill size.

| Tracking method | Behaviour |
| --- | --- |
| Daily estimate | Starts with the stock left after today's use. Subtracts the entered daily amount for each later Melbourne calendar day. |
| Manual count | No automatic deduction. Record pills used, receive a refill or enter a fresh count. |
| Mark ordered | Adds a label only. It does not add stock or place an order. |
| Refill received | Adds pills to the current balance and clears the Ordered label. |

The refill queue shows stock at or below its threshold. Daily estimates also show complete days remaining and the first day with insufficient stock for the entered daily amount. The 28-segment rail represents future daily cover, not adherence or an expiry date.

All dates use Australia/Melbourne, including daylight-saving changes. Estimates catch up on opening or resuming the app, without needing a timer to run while it is closed. Run-out and refill dates stay anchored to the last count, even after an estimated balance reaches zero. Recount when actual stock differs. A future count date is flagged for review instead of being treated as a reliable forecast.

Fractional inventory is accepted in steps of 0.25. This does not imply that a particular medicine can be split. The tracker does not recommend, verify or record prescribed dosing, interactions or adherence. Follow the prescription, not this app.

## GitHub Pages

The source is intended for `Sajeevanveeriah/pill-tracker`, branch `main`, published from the repository root. This package is prepared source, not evidence of a commit or deployment.

After the approved files are committed and pushed, select **Settings > Pages > Build and deployment > Deploy from a branch**, then **main / (root)**. No Actions build workflow is needed. Keep `index.html`, `styles.css`, the JavaScript modules, `sw.js`, `manifest.webmanifest`, `.nojekyll` and `assets/` together at the root.

Expected address after publication, not live-verified: `https://sajeevanveeriah.github.io/pill-tracker/`.

App assets, the start URL and the service worker use relative paths. The explicit manifest ID `/pill-tracker/` distinguishes it from the portfolio app on the same origin. Cache names include the app scope, and activation only removes this app's previous caches. It must not clear other site caches.

## Phone setup

On iPhone, open the published page in Safari. Tap **More > Share**, or **Share** directly depending on the Safari layout, then **Add to Home Screen**. Enable **Open as Web App** if shown, then tap **Add**. On Android, use the browser's **Install app** or **Add to Home screen** option.

Install first, then enter or restore the stack in the home-screen app. Browser and installed-app storage can differ. Open online once and wait for **Offline ready** before trying airplane mode. Refill notices are inside the app only; there are no closed-app push notifications or alarms.

## Local data and recovery

The app stores a versioned JSON record under the localStorage key `sv-pill-tracker:v1`. It contains medication names, optional strength text, counts, forecast settings, order labels, appearance and up to 100 recent inventory changes. It never sends that record to a server.

Use **Settings > Export backup** after important changes. Restore validates the file, previews its contents and asks before replacing the current stack. Backups are readable JSON, not encrypted. Demo data exists in memory only and does not replace or enter the saved stack.

Browser storage can be cleared, denied or evicted. Changing device, browser or origin does not automatically transfer it. The app is not an encrypted vault and does not have a PIN screen. Other scripts served from the same GitHub Pages origin share that browser-storage security boundary; a project subdirectory is not a separate origin. GitHub still receives ordinary static-page requests.

Failed or conflicting writes show an error rather than a success message. The app checks for stale data and uses Web Locks where available. Browsers without Web Locks retain the stale-write check, but it is not a guarantee against perfectly simultaneous writes from separate tabs. Prefer one active editing tab. Damaged or unsupported data is not silently erased; Settings offers the original stored text for recovery and a validated backup restore.

Undo restores the immediately preceding change while the app remains open and no intervening change has replaced it. A browser restart does not retain the undo snapshot. The recent-changes list is inventory history, not a clinical record.

## Source and design

The interface is hand-coded HTML, CSS and JavaScript: a refill-first overview, large counts, explicit estimated/recorded labels and thumb-accessible stock controls. Light, dark and system appearance are supported. Native labelled forms and dialogs provide keyboard interaction. Status uses text as well as colour. No UI template, external font or generated brand mark was used.

The SV monogram is copied from the existing portfolio's `public/favicon.png`. Its Git blob SHA is `e9534ff92eadd35791fe96266634a0cfd49f7057`. `assets/SV-Monogram.png` preserves those 10,500 source bytes. The 180, 192 and 512 pixel icons are padded and resized derivatives of that 128 pixel raster, not newly drawn or higher-resolution originals.

A bounded feature comparison with Medisafe's published features informed the narrower scope: inventory and refills here, without its clinical, family-tracking or communication features. No Medisafe design or assets are included.

## Development and verification

Runtime target: modern browsers with JavaScript modules, native dialogs, Web Crypto and localStorage; service workers require HTTPS or a trusted local development origin. There is no production Node or Python process.

For a local preview, with Python already installed, run this from the source directory:

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory .
```

Open `http://127.0.0.1:8000/` in a browser. Do not open `index.html` directly as a `file:` URL: module loading, browser storage and offline features do not have the same behaviour there.

For the dependency-free model, storage and worker-contract tests, use Node 22 or later:

```sh
node --test tests/inventory.test.mjs tests/storage.test.mjs tests/pwa.test.mjs
```

Optional interface tests require Python 3.10+, Playwright and a Chromium executable already installed. `CHROMIUM_PATH` can select an existing executable. With the static preview server running:

```sh
python -B tests/browser.test.py --url http://127.0.0.1:8000/
```

The isolated mode renders the authored document in memory when URL navigation is blocked:

```sh
python -B tests/browser.test.py --isolated
```

Verification in the build environment used Linux, Node 22.16.0 and Chromium 144.0.7559.96. Code and isolated UI checks cover inventory arithmetic, fractions, date rollover, daylight saving, overdue forecasts, validation, storage errors, stale writes, imports, exports, undo, ordered labels, native dialog focus, 320-1280 pixel layouts, desktop 200% zoom, reduced motion, touch targets and selected light/dark contrast pairs. Source syntax, paths, manifest and PNG formats are also checked.

**Limit:** managed browser policy rejected local URL navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`. No policy was changed. Isolated UI tests use in-memory storage and UUID fixtures, bundle the modules and omit the page CSP only in the test document. They do not establish real origin storage, browser-module delivery, CSP enforcement, service-worker lifecycle or phone installation. The live offline integration test is explicitly skipped in isolated mode. Safari, iOS home-screen behaviour, VoiceOver and a deployed GitHub Pages build have not been tested.

Before relying on the published app, run the integration suite, then on the intended phone: install it, enter a fictional count, close and reopen, enable airplane mode, recount, close and reopen again, and export/restore a backup. The final count must survive unchanged. Replace test data with real entries only after that check.

For an app update, change the `RELEASE` identifier in `sw.js` together with the shell files. An existing session offers **Reload to update** after the new worker installs. Finish any open form before choosing it. Updates must preserve the data schema or include a validated migration; never silently reset medication data.

## References checked for this build

- GitHub Pages publishing source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Apple home-screen web apps: https://support.apple.com/en-au/guide/iphone/iphea86e5236/ios
- MDN manifest identity: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id
- MDN offline operation: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
- MDN localStorage: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- Feature comparison: https://medisafeapp.com/features/
