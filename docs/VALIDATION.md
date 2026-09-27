# Frontend validation — Points Lab

Worker report, 2026-09-27. This is local validation evidence, not independent network certification.

## Delivery and scope

Implemented the one-page Vite/React/TypeScript frontend and production static export. The runtime loads `dist/imd-deployment.json` and the ABI JSON referenced by that manifest. Exact handoff identifiers, deployed contract set and canonical ABI hashes were checked against source commit `ba53f7b17a228179769e3d139e36d3fa82f778d4`. The network object is unchanged. Export integrity currently passes for 9 assets plus the manifest, totaling **527,601 bytes**, well below the HTTP-response and per-file limits.

All created deliverables are under `web/`, `dist/` or `docs/`; the sole ignore-file change is the explicitly budgeted `web/.gitignore`. Existing Solidity, ABI source exports, root build configuration, root ignore file, dependencies in `lib/` and CI files remain unchanged. No submodules or dependency/cache directories are submitted. Tool/browser downloads stay in `test/scratch/`.

**Commit limitation:** `git add -- web docs dist` was attempted and returned `fatal: Unable to create .../.git/index.lock: Read-only file system`. This worker can write the deliverable files but cannot stage or commit them because `.git` is mounted read-only. The files remain ready for collection by the publisher. No commit or publication is claimed.

Two contradictory assignment details are documented explicitly:

- Root `DESIGN.md` falls outside the overriding write budget, so the requested design content is in `docs/DESIGN.md`.
- The specific workflow requires PoolSwapTest, which the immutable network object omits. `web/config/router.json` and manifest `router` supply its address from [Uniswap's published Sepolia deployments](https://docs.uniswap.org/contracts/v4/deployments#sepolia-11155111), retrieved 2026-09-27. Swaps and token approvals use that router; quotes and price reads use the supplied network entries. This preserves the network block but cannot meet the literal general criterion that every swap/approval address already occur within that block. The two requirements cannot both hold without changing the pinned network data or replacing the requested router.

## Commands and outcomes

Commands run from `web/`, unless stated otherwise:

| Check | Outcome | Evidence |
| --- | --- | --- |
| `npm install`, later locked `package-lock.json` | Dependencies installed locally; not included in submission | `web/package.json`, `web/package-lock.json` |
| `npm run typecheck` | Passed (exit 0) | `evidence/typecheck.txt` |
| `npm run build` | Passed after final source edits; Vite relative export plus regenerated manifest | `dist/index.html`, `dist/imd-deployment.json` |
| `npm test` | 6 tests passed | `evidence/unit-tests.txt` |
| `npm run check:export` | All exported SHA-256 values, asset set, identifiers and network match | `evidence/export-integrity.txt` |
| `PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npm run test:browser` | 14 browser scenarios passed | `evidence/browser-results.json`, `evidence/browser-tests.txt` |
| `PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers node tests/live-browser.mjs` | Production page read live RPC data; zero console errors/failed requests; missing-wallet recovery passed | `evidence/live-browser.json`, `evidence/live-browser.txt` |
| `npm run check:live` | RPC chain, code, manager bindings and view reads passed; buy quote passed, sell quote reverted | `evidence/live-read.json` |
| `git diff --check` | Passed; existing tracked files have no changes | Path/size check below |

Browser adapter availability was tested first: the supplied MCP browser could not launch because `/home/seat/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome` was absent. No out-of-scope installation was attempted. Playwright 1.58.2's Chromium 145 was installed under `test/scratch/browsers` and used through the checked-in foreground validation scripts. The scripts run a temporary HTTP server at `/preview/`, close the browser/server, and exercise actual production JavaScript. This is rendered browser validation, not source-only inference; the supplied MCP launcher itself remains unavailable.

Representative final screenshots were opened and inspected through the image-viewing tool. Desktop and intermediate layouts keep the form and leaderboard side by side; mobile stacks them with readable inputs and no clipped controls. The focus screenshot shows the dark skip-link perimeter. See `evidence/live-1440.png`, `live-390.png`, `live-320.png`, `mock-1440.png`, `mock-820.png`, `mock-390.png`, `mock-320.png` and `keyboard-focus.png`. Files prefixed `mock-` contain fixture balances/rankings; production includes no fixture data.

## Interaction coverage

Browser tests intercept the pinned public RPCs and inject an EIP-1193 provider. Transaction requests are decoded and asserted locally; no test signs or broadcasts a real transaction.

- Reads while disconnected, on-chain top ten and pool-filtered Points events.
- Keyboard skip link, tab navigation from amount through limit to quote, semantic labels, focus on invalid input; field-specific `aria-invalid` for amount and price limit.
- Connection, visible wrong-network state, switch failure 4902, exact add-chain parameters and second switch.
- Empty/overprecision input, insufficient balance, price-limit validation and zero-current-tick-liquidity quoting.
- Native buy: simulated quoter request, 32-byte connected-wallet hookData, simulated PoolSwapTest execution, negative exact-input amount, direction-specific sqrt-price limit, native transaction value, successful mocked receipt.
- Sell: exact PNTS approval directly to PoolSwapTest, successful receipt, fresh quote, token-input swap without native value. No Permit2 approval or unlimited allowance.
- Wallet rejection and execution revert: recoverable errors, no failed transaction broadcast.
- Account and chain changes invalidate quotes. Expired quotes disable confirmation; service also enforces expiry immediately before sending.
- Missing wallets, empty leaderboard/history, missing contract code and RPC chain mismatch; missing-code retry recovers.
- Tampered implementation ABI fails before transaction UI loads.
- Desktop 1440px, intermediate 820px, mobile 390px and narrow 320px: no horizontal overflow, zero axe WCAG 2 A/AA + 2.1 AA findings in the inspected states, reduced-motion transitions disabled. 200% root text enlargement at 820px also reflowed without horizontal overflow.

Node tests independently cover ABI canonicalization/handoff binding, exact decimal parsing and dust, rejection of invalid amounts, conservative integer price-limit rounding in both directions, signed settlement-delta decoding, exactly 32-byte hookData, the exact multiplier boundary, relative-path traversal rejection and add-chain/rejection behavior.

## Live chain observations

Read-only evidence at block **11791694**:

- Chain ID 11155111; nonempty runtime bytecode: Points 1,753 bytes, SwapPointsHook 4,335, PoolSwapTest 6,950, PoolManager 24,009, Quoter 5,820 and StateView 3,531.
- Hook and PoolSwapTest both report the pinned PoolManager.
- Pool ID `0x002c5751b9c403edd9ba1c32e24488212b5291578d50381d9cb81ed4f7f58f25`.
- StateView slot0 sqrtPriceX96 `560227709747861399187319382274582`, tick 177284, LP fee 3000; live spot price is 50,000,000 PNTS per ETH. This differs from the handoff's initial-price description, so the page correctly displays StateView, not the initial value.
- Current-tick active liquidity is zero. A read-only 0.001 ETH buy quote nevertheless returns `49627085152468411915572` PNTS base units by traversing to available liquidity. A 1,000 PNTS sell quote reverts with signature `0x6190b2b0`; a sell is not currently established as possible by this evidence. The deployed pool began one-sided.
- The multiplier ends at Unix time 1791093984. The on-chain board and bounded recent event history were empty at observation time.

No funded live approval, buy, sell, wallet extension UI or transaction receipt was exercised. Tests do not establish actual wallet compatibility across all vendors, gas costs, future liquidity or future RPC availability. They do not establish that this test router offers minimum-output or deadline protection: it does not. The price-limit/partial-fill limitation is visible before quoting and explained in `web/README.md`. No contracts were redeployed.

## Better Interface consolidated review

The pinned workflow, all six domains' core principles and the design-documentation method were read and applied during implementation. `docs/DESIGN.md` records the resulting source values. Coverage refers to the actual page, not a claim that every appendix check was performed.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native buttons/inputs/table/disclosure, labels, field errors, skip link, visible focus, named wallet controls, status/alert regions, keyboard quote flow and axe scans. Screen-reader session, native-device interaction and full focus review across every state are **not verified**. |
| Layout | Checked | Shared shell, DOM reading order, responsive statistics/panels, growing IDs, four viewport widths and 200% text enlargement. Browser-native zoom and RTL mirroring are **not verified**; translated layouts are not implemented. |
| Writing | Checked | Verb-led action labels, distinction between PNTS and points, spend/approval steps, partial fills, no-value/spoofing/farming explanation, error recovery and empty states. |
| Typography | Checked | System-family declarations, hierarchy, units, input sizes, wrapping and tabular numbers; desktop/intermediate/mobile screenshots. Exact installed font families vary; no external font-load claim. |
| Colors | Checked | Semantic token roles, one accented primary action, textual status cues, rendered contrast samples and axe. Light theme only; dark theme is **not applicable**. Hover, disabled, forced-color and every error-pair contrast are **not comprehensively measured**. |
| UI | Checked | Normal/selected/loading/disabled/empty/error/confirmed states, native disclosure, restrained surfaces, 120ms press/hover transitions and reduced-motion suppression. Animations-panel playback at 10% speed and physical touch feedback are **not verified**; overlays are **not applicable**. |

Rendered WCAG contrast was calculated from computed foreground and resolved solid background values in `browser-results.json`: primary action 10.40996:1; secondary intro/label on page 5.93785:1; text on panel 12.92148:1. These are measured pairs, not a declaration of complete accessibility conformance.

### Findings and fixes

| Severity/domain | Final source location | Evidence, change and recheck |
| --- | --- | --- |
| High / interaction | `web/src/chain.ts:285` | Initial implementation rejected zero current-tick liquidity. Live StateView returned zero while the actual buy quoter succeeded. Removed that incorrect gate; an initialized pool still requires a successful quote and router simulation. Mock browser swap tests deliberately use zero current-tick liquidity and pass. |
| Medium / writing, UI | `web/src/chain.ts:12`, `web/src/App.tsx:257` | A failed simulation initially exposed a generic RPC error and retained the earlier “checking execution” status. Extract nested provider reason/details and replace stale progress with a no-submission recovery message. Standard execution-revert and rejection scenarios pass with no write. The fixture was also corrected to emit Ethereum's actual execution-reverted error shape. |
| Medium / accessibility | `web/src/App.tsx:49`, `web/src/App.tsx:552` | Price-limit validation originally marked the amount field invalid. Added a field target so the focused invalid price field receives the state and the amount does not. Browser test enters a zero price limit and asserts focus and both invalid attributes. |
| Medium / layout | `web/src/styles.css:810` | Final 390px screenshot showed wrapped wordmark and wallet text although 320px fit. Moved compact header styling to the 45rem breakpoint, kept labels on one line and stacked price units at mobile widths. Rebuilt and repeated browser/reflow checks. |
| Low / maintainability | `web/vite.config.ts:6` | A bare development server would not serve generated runtime configuration. Added tightly scoped middleware for the existing built manifest/ABIs and documented the initial build prerequisite. Production routing remains entirely static. |

Test-harness syntax and late fake-clock installation failures were repaired before the final run; they were not app behavior claims. Final browser artifacts report all scenarios passed, with no page-console errors or failed static resources.

## Completion and remaining constraints

The useful frontend source, lockfile, static export, manifest and local evidence are delivered and validated. The requested Git commit is **blocked by the read-only `.git` mount**. The two assignment conflicts above remain explicit deviations, not silently claimed passes. The publisher must collect/commit these files before hosting them. No URLs, CIDs, immutable-copy checks, named-entrypoint checks or publication success are claimed by this worker.

Submission-size check before the final mobile-header refinement: a temporary isolated clone copied the allowed deliverables, made a validation-only snapshot and ran `git bundle create --all`. The resulting complete-history candidate bundle was **1,942,230 bytes** against the **8,388,608-byte** limit. The source repository was not modified by this check. The temporary clone/bundle were removed; only the small size evidence record and this paragraph were added afterward, leaving over 6 MiB of margin. See `evidence/submission-size.json`.

The final mobile-header refinement was rebuilt, and typecheck, export integrity, all 14 interaction scenarios, axe/reflow checks and the live browser check passed again. `evidence/build.txt` records the final build. The final 390px screenshot was inspected: header controls now remain on one line and price units remain together. A separate short-lived Vite middleware probe returned HTTP 200 for the manifest and ABI; closing that probe during dependency discovery produced a shutdown-only scanner warning, not a production-page failure.
