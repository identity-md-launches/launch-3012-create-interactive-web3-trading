# Squeek Price Action Terminal

## Overview

A dark trading desk for reading hamster activity and predicting the next Squeekchain round. The main visual idea is a precise financial terminal powered by an unexpectedly small source of movement. The chart, prediction ticket and results carry the page; there is no marketing hero.

The canonical implementation is [src/styles.css](src/styles.css), with composition in [src/App.tsx](src/App.tsx). This document describes the finished source, including its deliberate compact desktop controls.

## Colors

CSS defines a neutral ramp and semantic roles. Components use the role tokens.

| Role token | Value | Use |
| --- | --- | --- |
| `--color-page` | `#101211` | Page and input backgrounds |
| `--color-surface` | `#151816` | Chart, ticket, dialog |
| `--color-surface-raised` | `#1a1e1b` | AI icon surface |
| `--color-control` | `#222823` | Neutral controls, selected segments, badges |
| `--color-hover` | `#2a322b` | Pointer hover surfaces |
| `--color-border` | `#303931` | Structural outlines |
| `--color-border-control` | `#5f7064` | Input, stake preset and unselected direction boundaries |
| `--color-border-subtle` | `#252c27` | Chart grid and separators |
| `--color-text` | `#edf1eb` | Primary text |
| `--color-text-secondary` | `#a0aaa3` | Supporting text |
| `--color-text-muted` | `#849087` | Axis labels and low-priority metadata |
| `--color-accent` / `--color-focus` | `#c3f17a` | Primary action, brand, focus ring |
| `--color-accent-hover` | `#acdc65` | Primary action hover |
| `--color-on-accent` | `#18210e` | Text on lime and the chart value tag |
| `--color-positive` | `#7eddb3` | Long, gains, rising candles |
| `--color-negative` | `#f19aa2` | Short, losses, falling candles |
| `--color-warning` | `#e6c586` | Practice source and unavailable data |
| Positive / negative / warning subtle | `#1c3028` / `#342226` / `#302a1e` | Selected directions and status surfaces |

Selected Long and Short boundaries are `#558568` and `#a16b72`. Direction arrows, check marks and written states accompany color. The selected game mode has a check mark. The terminal intentionally has one dark theme.

The review measured body, secondary and muted text on the surface at 15.66:1, 7.47:1 and 5.38:1. The control boundary measures 3.40:1 there. Chart volume uses 55% opacity: blended mint and rose measure 4.15:1 and 3.39:1. See [validation](artifacts/validation.md) for measurement scope and limits.

## Typography

Local variable **Geist** is the interface family; local **Geist Mono** is for values, timers and compact data. Files are `public/fonts/geist-latin.woff2` and `geist-mono-latin.woff2`, with Arial and system monospace fallbacks. Both font files support weights 100–900; the UI uses only 400, 500 and 600. Their licenses are bundled locally.

The six-size scale is defined by `--text-xs/sm/base/md/lg/xl`: **12, 14, 16, 20, 28, 36px** at the default root size. The main heading is 28px; the prominent index is 36px on desktop. Panel headings use 16 or 20px, ordinary interface copy 14px, and data captions 12px. Inputs are at least 16px on phones. Prose has a 1.5–1.6 line height; the main heading is 1.2. Headings use balanced wrapping; prose uses pretty wrapping. Long names wrap without truncation.

Numbers use tabular figures and `Geist Mono` with −0.025em tracking. Heading tracking is −0.035em. The brand uses −0.045em at display size. Chart axes remain 12 CSS pixels: `ResizeObserver` matches SVG coordinates to its rendered surface. The faint 64px desktop / 36px phone chart wordmark is decorative SVG artwork, outside the interface type scale.

## Layout

The desktop header is 76px high, followed by a 72px shortcut rail and a main area capped at 1640px. Main gutters are 32px, then 24px at narrower desktop widths and 16px on phones. Groups generally use 16–24px spacing; compact controls use 4–12px spacing with optical adjustments.

The trading grid is `minmax(0, 1fr) 336px` with a 22px gap. The chart and signal list occupy the leading column, the prediction ticket the trailing column. Telemetry sits above; performance and activity sit below. At 1220px the ticket becomes 316px; at 800px it becomes 300px. The rail disappears at 1020px. At 800px the lower panels stack and the performance layout condenses.

At **680px and below**, the prediction ticket moves directly after the product heading, mode control and feed status. Telemetry then becomes a two-column grid, followed by the chart and signals. Performance uses two columns and the lower panels stack. This order puts the main action on the first 390 × 844 screen. At 360px, title size and compact rows adjust again. At 1700px, gutters become 40px and the ticket 370px.

The chart is 326px tall normally, 305px at intermediate widths, and 245px on phones. Expanded charts use 420px or 300px on phones. Missing round IDs keep their space on the chart; no missing observation becomes a zero. Candle data has an explicit disclosure and an independently scrollable table. The document does not scroll horizontally at the tested 320, 390, 768 and 1440px widths.

## Elevation & Depth

This is a flat interface. Tonal surfaces and one-pixel structural borders distinguish panels; there are no panel shadows, gradients or nested cards. Dialogs use the browser’s top layer with a 72% black backdrop and 4px blur. The header and rail remain in document flow, so they do not cover content.

## Shapes

Radius tokens are 6px for controls, 10px for compact/mobile panels, and 14px for desktop panels and dialogs. Segments and badges use 3–5px corners. Avatars and the instrument symbol are circles; the AI avatar uses an 8px square. Icons are custom SVGs in `src/components/Icons.tsx`, using `currentColor` and 1.5px strokes. The hamster illustrations use their own drawing geometry.

## Components

| Component or pattern | Source | Behavior |
| --- | --- | --- |
| `Chart` | `src/components/Chart.tsx` | 4h/12h/24h ranges, candle/line style, pointer inspection, arrow/Home/End inspection, data disclosure, expanded variant |
| `Dialog` | `src/components/Dialog.tsx` | Native modal, inert background, Escape/backdrop/close button, explicit focus restoration |
| Prediction ticket | `src/App.tsx`, `.prediction-panel` | Native radio group, 10–250 SQK stake, presets, reserved stake, immediate settlement feedback with receipt access, and persistent inline errors |
| Mode switch | `src/App.tsx`, `.mode-switch` | `aria-pressed` buttons, check-mark selection; distinct live and simulated records |
| Signal list | `src/App.tsx`, `.signal-item` | Named signal, written active/watching/building state, explanation, direction icon |
| Activity and leaderboard | `src/App.tsx` | Native tables/list, local player switching, round receipts, CSV export, honest empty states |
| Profile form | `src/App.tsx` | Visible label, 24-character name, unique-name validation, focuses the invalid input |

Loading retains the ticket structure. API errors explain refresh/practice recovery. Stale data prevents new live predictions; last good values remain visible. Pending predictions cannot be placed twice. Success and void settlement update a stable polite live region. Storage failures state that persistence is unavailable.

Interactive focus uses a 2px lime outline with 4px offset; radio labels expose the input’s focus. Forced-colors mode uses system Highlight. Hover styling is gated by pointer capability. Only color/background/border transitions run, for 120ms, and only when reduced motion is not requested. There is no autoplay or endless animation. The primary action uses the guide’s 0.96 press scale under the same motion preference.

## Do’s and Don’ts

- Reuse the main grid, panel primitives and six-size scale for another terminal section.
- Use lime fill for the current primary action, mint/rose for outcomes and amber for data/source notices.
- Keep live and practice source labels visible; use “simulated” in practice receipts.
- Preserve the native radio, form, table and dialog semantics and keyboard paths.
- Keep numeric values selectable and names fully readable. Add compact data to a table rather than shrinking it.
- Never turn unavailable rounds into zeros, show synthetic prices as a market, or imply the local leaderboard is shared.

To add a section, place a named `section` in the existing main flow, reuse `.section-heading`, use semantic tokens, and give the mobile layout an explicit order. Check it at the documented widths before introducing another breakpoint or type size.
