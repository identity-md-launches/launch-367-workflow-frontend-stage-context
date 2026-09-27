# Points Lab design

## Overview

A quiet, light interface for people exploring a Sepolia experiment. The implemented page pairs a compact swap form with a ledger-like leaderboard. The introduction, live pool overview, primary task, recent activity and explanation follow that reading order. A warm paper background, dark forest text and one pale lime action keep the experience restrained. The dot-grid stamp and wordmark use HTML/CSS; there are no external images or fonts.

This document lives under `docs/` because the assignment's overriding path budget excludes root `DESIGN.md`.

## Colors

Canonical definitions: `web/src/styles.css:1`. Components use semantic tokens.

| Token | Resolved value | Role |
| --- | --- | --- |
| `--bg` | `#f4f3ec` | Page and amount-entry background |
| `--surface` | `#fcfcf8` | Panels, selected direction |
| `--surface-muted` | `#eaeae0` | Notice, segmented track, small neutral markers |
| `--text` | `#263323` | Body, headings and action labels |
| `--text-muted` | `#53614b` | Secondary labels and supporting copy |
| `--border` | `#d5d8c9` | Structural separators |
| `--control-border` | `#738169` | Interactive outlines |
| `--accent` | `#d7ed97` | Primary action fill |
| `--accent-hover` | `#c5df7b` | Primary hover fill |
| `--focus` | `#263323` | 3px focus perimeter, 4px offset |
| `--error` | `#8d341f` | Error copy and error border |

The primitive paper, forest, lime and rust tokens are declared above these roles. No dark theme exists. The main form action owns the accent fill; header and transaction-confirmation buttons remain neutral. Status always has text. Measured rendered contrast: primary label/fill 10.41:1, secondary text/page 5.94:1, primary text/panel 12.92:1. See validation for measurement coverage.

## Typography

`--font-body` is `'Helvetica Neue', Helvetica, Arial, sans-serif`; `--font-editorial` is `Georgia, 'Times New Roman', serif`. All fonts come from the operating system; no downloadable font files are needed. Exact installed faces vary by device. Source requests weights 400, 500 and 600, with `font-synthesis: none`; the system chooses available matches. Root font smoothing is applied once.

The main heading is `clamp(2.6rem, 4.7vw, 4rem)`, weight 500, line-height 1.13, tracking −0.045em. Its second line uses the italic editorial family at weight 400. At ≤24rem viewport width, the heading is 2.5rem. Section headings use 1.75rem/1.13 at weight 500; recent activity uses 1.5rem. The lower editorial heading is 2.5rem/1.12 italic. Body text is 1rem/1.5, with intro copy at 1.65 and explanatory copy at 1.7. Labels use 0.8125rem; uppercase eyebrow text uses 0.6875rem, weight 600 and 0.14em tracking.

Numbers in statistics, the table and activity use tabular numerals. Amount inputs are 2rem (1.6rem at the narrowest breakpoint); the price limit input is 1rem. Headings balance wrapping; short prose uses pretty wrapping. Long explanatory text has a 65ch cap. Addresses appear shortened in dense lists with full address accessible names/explorer destinations; deployment details wrap complete addresses and pool IDs.

## Layout

`.shell` supplies a maximum width of 1184px and 40px inline padding. The page uses 8/12/16/24/28/40/44/62px spacing depending on component grouping. Desktop `.workspace` has a swap column capped at 440px and a flexible leaderboard, separated by 24px. Statistics form three equal columns. Panels follow the natural document flow; no sticky bars or overlays obscure content.

At 58rem, shell padding becomes 24px, panel padding 22px, and the columns share available width. At 45rem, the compact single-line wordmark/wallet header is applied, price units sit below the number, the task panels stack, the decorative stamp and header network label disappear, statistics become two columns with the multiplier across the next row, and secondary section headings stack. At 24rem, shell padding is 16px, panel padding 18px, wallet/amount typography reduces further, and table ranks narrow. At small widths, the full testnet identity remains in the introduction and wallet network-switch control. Deployment metadata uses a native disclosure and changes to one column on mobile.

Screenshots and browser measurements cover 1440, 820, 390 and 320 CSS pixels. No horizontal overflow was observed in those tested states. A 200% root-text-size check also passed; that is not a browser-native zoom test.

## Elevation & Depth

Panels use two subtle shadows, `0 1px 2px #2633230d` and `0 0 0 1px #2633230d`, to separate their off-white surface from the page. Selected swap direction has a small shadow and visible border. Dividers organize statistics, ledger rows and section boundaries. There are no dialogs, floating menus or high elevation layers.

## Shapes

Panel radius is 18px. Primary and segmented-track radii are 9px; nested segment buttons are 6px. Amount boxes use 10px; wallet/secondary buttons and notices use 8px. Token markers, stamp dots and the decorative swap marker are circles. Pills use a 20px radius. Input and interactive borders are distinct from the pale structural separators.

## Components

`web/src/App.tsx` defines the page's reusable patterns (not a separately published component library):

- Header wallet control: neutral 44px minimum target; becomes a shortened connected address with a full accessible disconnect label. Wrong-network correction has one form control.
- Swap direction: native buttons with `aria-pressed` inside a named group. Amount/price fields have explicit labels, descriptions and targeted invalid states. Errors focus the affected input. The primary button changes from connection to network switch to quote according to prerequisites.
- Quote review: inline description list, 30-second expiry, exact spend, estimated points, approval/confirmation step. Pending writes disable duplicate actions; status and errors persist in dedicated live regions.
- Statistics: role-specific labels, stable numeric typography, explicit loading/empty/stale states. The countdown is visually updated from chain time without a per-second live announcement.
- Leaderboard: semantic table with caption, scoped headers, rank, linked wallet and formatted points. Empty state explains how to appear on the board. No placeholder scores ship in production.
- Recent awards: transaction links, earned points and block identifiers. The visible range and result cap are explicit; mobile omits the redundant block label while retaining the transaction link.
- Deployment disclosure: native `details`/`summary`, full selectable values and explorer links.

All interactive elements use native keyboard behavior. The first tab stop is a visible-on-focus skip link. Focus uses the shared token and changes to the system Highlight color in forced colors. Buttons have ≥44px minimum height. Hover styling is limited to hover-capable pointers. Under `prefers-reduced-motion: no-preference`, only button background/transform transition over 120ms with ease-out; press scale is 0.96. Reduced motion removes those transitions. No entrance animation exists.

## Do's and Don'ts

Reuse `.shell`, `.panel`, `.section-heading`, `.subtle`, `.primary` and `.secondary` when extending the page. Preserve one clear form action and use explicit disabled explanations when chain or verification checks fail. Keep token units and hook points distinct. Read values from the runtime configuration and contract state.

Do not introduce reward-value claims, fictional balances or a decorative price chart. Do not use structural border colors for body text. Do not add external font/CDN dependencies or routes that require server rewrites. To add a section, keep it in main's reading order, use a semantic heading and existing spacing/text roles, then recheck 320px reflow and keyboard reachability.

Design guidance was applied from Jakub Krehel's Better Interface (MIT), pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation structure follows Paul Bakaus's Impeccable (Apache-2.0), pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. These are implementation notes, not reproductions or relicensing of those works.
