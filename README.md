# Squeek Price Action Terminal

A static React + TypeScript prediction game powered by Squeekchain’s public API. Read live wheel telemetry and derived candlesticks, inspect algorithmic signals, then predict whether the next round meets a fixed work target. Compete against a transparent rules-based AI with virtual SQK.

## Install, run and rebuild

Use Node.js 22.18+ and npm.

```sh
npm ci
npm run dev
```

Create and preview the production export:

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

`dist/index.html` and its complete runtime assets are included. Serve `dist/` over HTTP; no server application, credentials or wallet is needed. Vite uses `base: './'`, so the export also works below a static gateway subpath. Opening ES modules directly with `file://` is not the supported preview method.

Fonts, favicon, share image and icons are local. To regenerate the included share PNG after editing `public/social-card.svg`, install Chromium with `npx playwright install chromium` and run `npm run render:social`, then rebuild.

## Play

1. Choose **Live API** or **Practice**. Practice is clearly simulated, settles in 20 seconds and offers a fast-forward control.
2. Choose **Long** for work at or above the target, or **Short** for work below it. The target is the rounded median of the latest 12 observed confirmed rounds, with a minimum of one wheel unit.
3. Choose a virtual stake from 10 to 250 SQK and lock before the predicted round starts. The target, AI call and streak multiplier are frozen at entry.
4. The stake is reserved. A win returns the stake plus `stake × multiplier`; a loss costs the stake. Each consecutive win adds 0.1× to the next prediction, capped at 2×. Losing resets the streak.

Each local trader begins with 1,000 virtual SQK in each mode. Add or switch traders using the profile control. Live and practice ledgers stay separate. The leaderboard ranks players in this browser; its AI row benchmarks the active trader’s matched stakes. Position receipts show locked values and outcomes. CSV exports include the full history even when the interface shows only its latest 20 entries.

## Live data and settlement

The [official API documentation](https://docs.squeekchain.com/developers/api/) defines the data consumed in `src/api.ts`:

| Endpoint | Use |
| --- | --- |
| `/v1/status` | Accepted speed, RPM, device-day distance, source, freshness, open-round work and settlement frontier |
| `/v1/core` | Genesis timestamp, round duration, safe frontier and recent confirmed batch events |
| `/v1/events?category=protocol&limit=100` | Exact safe settlement history; bounded cursor pagination for roughly a day of initial history |
| `/v1/measurement/stats?range=7d` | Lifetime distance/work ratio for the projected candle |

Status and core refresh every 15 seconds while the tab is visible, and on return to it. Protocol history refreshes when the frontier advances. Statistics cache for five minutes. Initial history reads at most four pages within an eight-second budget; individual requests time out after 12 seconds. History availability can be shorter than the selected chart range.

The chart is an **activity index, not a traded token price**: `100 + round work`. A historical candle opens at the previous observed close and closes at the confirmed work index; its high/low are the known endpoints. Historical intraround extremes are unavailable and are not invented. The current candle projects remaining work using current speed and the observed distance-per-unit ratio. Current speed and daily distance also appear directly in the telemetry strip. Missing rounds retain gaps on the time axis.

The signal engine detects pace above the recent high, a median reclaim, and exhaustion/restart reversal zones. The AI forecasts from 65% projected current work and 35% mean work over the latest three observed rounds. Its 50–85 strength score is a heuristic, not a probability or trained model.

Live predictions settle only against an exact confirmed per-round result. Zero-work batches can establish zero work for each covered round; mixed nonzero batches cannot establish individual results. If the exact result remains missing after two further settled rounds, or the API installation changes, the stake is returned as a void. Last good telemetry stays visible during errors; stale or faulty data blocks new live predictions.

## Validation performed

The worker ran the production build, TypeScript typecheck, 20 engine/data tests and a Chromium interaction suite. The final suite covers 18 flows, including placement, stake reservation, settlement, stale/failure/retry states, frozen live targets, automatic practice timers, dialogs, local profiles, persistence, CSV, chart controls and responsive layouts. The supplied taste@1 probe passed **16/16 checks**. The first 390 × 844 screen includes the product and primary action. The production export was served under `/preview/` to verify relative assets.

See [artifacts/validation.md](artifacts/validation.md) for actual commands, evidence, six-domain design coverage, corrections and limitations, and [DESIGN.md](DESIGN.md) for implemented tokens and components.

To run the browser suite on another machine:

```sh
npx playwright install chromium
npm run build
npm run validate:browser
```

Worker dependencies were installed only in disposable scratch space. The same Vite config supports that isolated installation through optional `SQUEEK_DEPENDENCY_MANIFEST`; ordinary installs need no environment settings. `SQUEEK_CHROMIUM_PATH` optionally selects a locally installed Chromium. `SQUEEK_API_BRIDGE=1` is a test-only curl transport for restricted renderers; it is never used by the website.

## Limits

- This is a local virtual game. Scores are editable browser data, are not tamper-proof, and do not synchronize between visitors or devices. No tokens are held, bought, minted or transferred.
- Live data and confirmation timing depend on Squeekchain. The client uses the browser clock for round timing. The interface does not promise a settlement time.
- The renderer on this worker could not make direct external requests. Real public API responses were relayed through curl for the live browser smoke test; direct HTTP access and permissive CORS were checked separately. A simulated API fixture tested complete live settlement without waiting for a real round.
- Chromium was tested. WebKit could not launch because system libraries are missing. Physical devices, assistive screen readers and native browser zoom were not tested.

## Submission budget

The allowed total is 8,388,608 bytes. `.gitignore` gives generated dependencies/caches and `test/scratch/` a **zero-byte submission budget**, at every nesting level. `dist/` has a **1 MiB budget** and remains included. Source, lockfile, local assets, licenses, documentation and selected review evidence share the remaining budget. No dependency registry, archive, submodule or backend is required.

## Attribution

Geist and Geist Mono are bundled under SIL OFL 1.1. React is bundled under MIT. Custom hamster artwork and icons are included in the source. The supplied Better Interface and Impeccable design/documentation guidance informed the implementation; see [NOTICE.md](NOTICE.md) and the retained licenses.
