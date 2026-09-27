# Points Lab frontend

One static React/TypeScript page for the deployed Sepolia Points experiment. Source, dependencies and build configuration live here; the ready-to-host export is `../dist/`. No backend, credentials, new contracts, deployment transaction or publication step is required.

## Install, build and preview

Use Node 22.12+ (worker: Node 24.9.0, npm 11.6.0). Start from a Git checkout that contains deployed source commit `ba53f7b17a228179769e3d139e36d3fa82f778d4`.

```sh
cd web
npm ci
npm run typecheck
npm run build
npm run check:export
npm run preview
```

Open the URL printed by Vite. For source development, run `npm run dev` after the initial build. Its middleware serves the same generated deployment/ABI files while Vite serves the source. Rebuild whenever configuration changes.

Vite uses `base: './'`. Serve the **contents** of root `dist/` over HTTP(S), including its manifest, `assets/` and `abi/`. The page also works beneath a gateway subpath; browser tests serve it at `/preview/`. There are no SPA routes or CDN assets. Opening through `file://` is not supported because configuration is fetched. Do not serve `web/` as the production site.

## Configuration and ABI provenance

`config/handoff.json` and `config/network.json` preserve the supplied public deployment and network handoffs. `config/router.json` records the separately published PoolSwapTest router required by this assignment, with its source URL. These are build inputs only. The application imports no address map from them.

`npm run build` first exports Vite, then `scripts/export.mjs`:

1. Reads `docs/abi/Points.json` and `docs/abi/SwapPointsHook.json` with `git show <deployed-source-commit>:<path>`; also compares the working ABI files.
2. Verifies Keccak-256 of recursively key-sorted, compact JSON, preserving array order, against each handoff `abiHash`. Any mismatch stops the build.
3. Exports those raw ABI arrays and minimal public StateView, Quoter and PoolSwapTest interfaces as local JSON. PoolSwapTest's interface is derived from the preserved `lib/v4-core/src/test/PoolSwapTest.sol`; the other interfaces implement Uniswap's published v4 read/quote surface.
4. Generates `dist/imd-deployment.json` with exact attested identifiers and contract set, the unchanged network object, supplied `walletAddChain`, pool/token metadata and the router supplement. Additional `interfaces` entries bind infrastructure ABIs.
5. Inventories every other exported file with lowercase SHA-256. The manifest excludes itself. A build must be rerun after any export change.

`src/config.ts` fetches that **same manifest** at runtime, validates chain consistency and local ABI paths, loads its referenced ABI JSON and verifies canonical ABI hashes before rendering transaction controls. All runtime addresses, chain metadata, RPC URLs and interfaces come from this object. The page displays its deployment links. `check:export` independently checks the exported inventory, hashes, handoff contract binding and unchanged network.

### Assignment conflicts resolved within scope

- Root `DESIGN.md` is requested, but the overriding path budget only allows `web/**`, `dist/**`, `docs/**` and `web/.gitignore`. The complete implemented design document is therefore `docs/DESIGN.md`; root files remain untouched.
- The assignment specifically requires **PoolSwapTest**, while the supplied network object omits it and a general criterion says swaps/approvals must use only that object's addresses. Those requirements cannot both be met literally. This implementation prioritizes the specifically requested router, using the published Sepolia address in the manifest's `router` supplement, and preserves `network` unchanged. Quotes, StateView and PoolManager use the pinned network entries. Approvals go directly to PoolSwapTest; Permit2 and Universal Router are unused. No router address is silently substituted. See validation for live code and manager checks.

## Wallets, swaps and observations

An injected EIP-1193 browser wallet (`window.ethereum`) is supported without a project ID. There is no WalletConnect integration or wallet selection modal. Missing wallets, rejected connections, changed accounts, disconnects and wrong chains have explicit states. Switching an unknown chain requests the exact supplied `wallet_addEthereumChain` parameters, then switches again. Signing stays in the visitor's wallet; read requests try the public RPCs in order and then the connected provider on the correct chain.

Public reads work before connection. Every 20 seconds the page reads StateView slot0 and current-tick liquidity, top10, multiplierEndsAt and hook rates; connected reads add token/native balances, allowance and pointsOf at the same block. Recent Points events are filtered to this pool over the latest 2,000 blocks (bounded by deployment), newest eight displayed. The leaderboard is the complete on-chain top ten, not reconstructed from recent logs. A failed refresh disables actions; data older than 60 seconds also disables them. Event failures do not hide otherwise healthy contract reads.

Exact-input buys spend native ETH, with no approval. Sells explicitly approve only the entered PNTS amount to PoolSwapTest, wait for a successful receipt, then require a new quote before swapping. The connected account is encoded as one 32-byte address in `hookData`. Before a write, the app rechecks the wallet account/chain, RPC chain, deployed code and hook/router PoolManager bindings. It simulates the approval/swap before requesting the signature. Receipts, reverts, rejection and pending confirmation have visible states and explorer links.

Quotes use `simulateContract(quoteExactInputSingle)` on the pinned quoter; they expire after 30 seconds and are invalidated by input/account/chain changes. Zero liquidity **at the current tick** is not used to reject a quote: a v4 swap may traverse an empty interval to reach seeded liquidity. Quote failure or an uninitialized pool stops progression.

**PoolSwapTest has no amountOutMinimum or deadline parameter.** The user sets a 0.1–5% terminal price movement limit (default 0.5%), converted with integer square-root arithmetic into `sqrtPriceLimitX96`. Router simulation checks signed settlement deltas and the estimated output rate before submission. This is not an on-chain minimum-output guarantee. Partial fills are possible, and the router refunds unused native ETH; points depend on the ETH actually settled. A delayed wallet signature or transaction inclusion cannot be constrained by an on-chain deadline. The UI discloses these limitations before quoting. Gas is additional.

PNTS and hook points are different: PNTS is a normal ERC-20; hook points are non-transferable and non-redeemable. Points and tokens have no value, and nothing promises a return. Hook identity is unauthenticated: anyone can credit any address. Round trips can farm points at the cost of LP fees and gas. There is no admin, mint, pause, sweep or points-transfer action to expose. Token transfers outside the specified buy/sell flow are outside this page's scope.

## Validation

```sh
npm test
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npm run test:browser
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers node tests/live-browser.mjs
npm run check:live
npm run check:export
```

Browser tests manage a temporary HTTP server and browser inside one foreground process and close them afterward. Wallet and RPC interactions are mocked in `tests/browser.mjs`; no test signs or broadcasts on Sepolia. `check:live` performs real read-only chain/code/binding/state/quote checks, and `live-browser.mjs` captures the real export with public RPC reads. Results, scope, observed failures/fixes and untested behavior are in `docs/VALIDATION.md` and `docs/evidence/`. Publication, IPFS, naming and funded live transactions are not claimed.

The explicit ignore-file budget is exactly **`web/.gitignore`**. It excludes dependency, package-manager, browser-report and build-cache directories at every nesting level under `web/`. Browser downloads and worker package caches use the already excluded `test/scratch/`. No dependency archive, node_modules tree, vendored registry or Git submodule is a deliverable.
