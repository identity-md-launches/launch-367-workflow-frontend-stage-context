import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeErrorResult,
  encodeAbiParameters,
  encodeEventTopics,
  zeroAddress,
  toHex,
} from "viem";
const root = resolve("../dist"),
  evidence = resolve("../docs/evidence");
await mkdir(evidence, { recursive: true });
const manifest = JSON.parse(
  await readFile(root + "/imd-deployment.json", "utf8"),
);
const abis = {};
for (const c of [...manifest.contracts, ...manifest.interfaces])
  abis[c.name] = JSON.parse(await readFile(root + "/" + c.abiPath, "utf8"));
const addresses = Object.fromEntries(
  manifest.contracts.map((c) => [c.name, c.address.toLowerCase()]),
);
const wallet = "0x1111111111111111111111111111111111111111";
const alternate = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "ab".repeat(32),
  blockHash = "0x" + "cd".repeat(32);
const now = 1790492100,
  blockNumber = 11791670n;
const out = (abi, functionName, result) =>
  encodeFunctionResult({ abi, functionName, result });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/preview/")) throw Error();
    const name = path.slice(9) || "index.html";
    if (name.includes("..")) throw Error();
    const body = await readFile(root + "/" + name);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[extname(name)] || "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const report = {
  startedAt: new Date().toISOString(),
  urlPath: "/preview/",
  tests: [],
  consoleErrors: [],
  resourceFailures: [],
  screenshots: [],
  contrast: [],
};
let page;
async function scenario(name, fn) {
  await fn();
  report.tests.push({ name, result: "passed" });
  console.log("PASS " + name);
}
async function setup(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  await page.clock.install({ time: new Date() });
  const state = {
    allowance: 0n,
    awards: options.empty ? 0 : 10,
    missingCode: false,
    wrongRpc: false,
    rpcError: false,
    quoteError: false,
    swapError: false,
    quoteDelay: 0,
    end: now + 86400 * 3 + 3661,
    tokenBalance: 100000n * 10n ** 18n,
    ethBalance: 10n ** 18n,
    transactions: [],
    calls: [],
    ...options,
  };
  page.on("pageerror", (e) => report.consoleErrors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") report.consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    if (req.url().startsWith(url)) report.resourceFailures.push(req.url());
  });
  await page.exposeFunction("mockSend", async (tx) => {
    state.transactions.push(tx);
    if (tx.to.toLowerCase() === addresses.Points) {
      const decoded = decodeFunctionData({ abi: abis.Points, data: tx.data });
      assert.equal(decoded.functionName, "approve");
      assert.equal(decoded.args[0].toLowerCase(), manifest.router.address);
      state.allowance = decoded.args[1];
    }
    return hash;
  });
  if (!options.noWallet)
    await page.addInitScript(
      ({ wallet, chainId }) => {
        const listeners = {};
        window.__wallet = {
          chain: chainId,
          account: wallet,
          added: false,
          rejectConnect: false,
          rejectSend: false,
          requests: [],
          emit: (name, value) => {
            for (const fn of listeners[name] ?? []) fn(value);
          },
        };
        window.ethereum = {
          on: (e, f) => (listeners[e] ??= []).push(f),
          removeListener: (e, f) => {
            listeners[e] = (listeners[e] ?? []).filter((x) => x !== f);
          },
          request: async (request) => {
            const s = window.__wallet;
            s.requests.push(request);
            if (request.method === "eth_chainId") return s.chain;
            if (request.method === "eth_accounts") return [s.account];
            if (request.method === "eth_requestAccounts") {
              if (s.rejectConnect)
                throw { code: 4001, message: "User rejected" };
              return [s.account];
            }
            if (request.method === "wallet_switchEthereumChain") {
              if (!s.added) throw { code: 4902, message: "Unknown chain" };
              s.chain = request.params[0].chainId;
              s.emit("chainChanged", s.chain);
              return null;
            }
            if (request.method === "wallet_addEthereumChain") {
              s.added = true;
              return null;
            }
            if (request.method === "eth_sendTransaction") {
              if (s.rejectSend) throw { code: 4001, message: "User rejected" };
              return window.mockSend(request.params[0]);
            }
            throw Error("Unexpected wallet request: " + request.method);
          },
        };
      },
      {
        wallet,
        chainId: options.wrongChain ? "0x1" : manifest.walletAddChain.chainId,
      },
    );
  async function rpc(request) {
    state.calls.push(request);
    const { method, params = [] } = request;
    if (state.rpcError) throw Error("RPC offline");
    if (method === "eth_chainId")
      return state.wrongRpc ? "0x1" : manifest.walletAddChain.chainId;
    if (method === "eth_getCode")
      return state.missingCode ? "0x" : "0x6001600055";
    if (method === "eth_blockNumber") return toHex(blockNumber);
    if (method === "eth_getBalance") return toHex(state.ethBalance);
    if (method === "eth_getBlockByNumber")
      return {
        number: toHex(blockNumber),
        hash: blockHash,
        parentHash: blockHash,
        timestamp: toHex(now),
        gasLimit: "0x1c9c380",
        gasUsed: "0x100",
        baseFeePerGas: "0x1",
        difficulty: "0x0",
        totalDifficulty: "0x0",
        extraData: "0x",
        miner: zeroAddress,
        nonce: "0x0000000000000000",
        size: "0x100",
        transactions: [],
        uncles: [],
        logsBloom: "0x" + "00".repeat(256),
        receiptsRoot: blockHash,
        transactionsRoot: blockHash,
        stateRoot: blockHash,
        sha3Uncles: blockHash,
      };
    if (method === "eth_getTransactionReceipt")
      return {
        transactionHash: hash,
        transactionIndex: "0x0",
        blockHash,
        blockNumber: toHex(blockNumber),
        from: wallet,
        to: manifest.router.address,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "00".repeat(256),
        status: options.reverted ? "0x0" : "0x1",
        effectiveGasPrice: "0x1",
        type: "0x2",
      };
    if (method === "eth_getLogs")
      return state.awards
        ? [
            {
              address: addresses.SwapPointsHook,
              topics: encodeEventTopics({
                abi: abis.SwapPointsHook,
                eventName: "Points",
                args: { poolId: params[0].topics[1], user: wallet },
              }),
              data: encodeAbiParameters(
                [{ type: "uint256" }, { type: "uint256" }],
                [20n * 10n ** 18n, 250n * 10n ** 18n],
              ),
              blockNumber: toHex(blockNumber),
              transactionHash: hash,
              transactionIndex: "0x0",
              blockHash,
              logIndex: "0x0",
              removed: false,
            },
          ]
        : [];
    if (method === "eth_call") {
      const tx = params[0],
        to = tx.to.toLowerCase();
      const name =
        to === addresses.Points
          ? "Points"
          : to === addresses.SwapPointsHook
            ? "SwapPointsHook"
            : to === manifest.router.address
              ? "PoolSwapTest"
              : to === manifest.network.uniswapV4.stateView
                ? "StateView"
                : "Quoter";
      const abi = abis[name],
        decoded = decodeFunctionData({ abi, data: tx.data }),
        f = decoded.functionName,
        args = decoded.args;
      if (f === "manager" || f === "poolManager")
        return out(abi, f, manifest.network.uniswapV4.poolManager);
      if (f === "getSlot0")
        return out(abi, f, [1000n * 2n ** 96n, 138162, 0, 3000]);
      if (f === "getLiquidity") return out(abi, f, 0n); // Exercise valid traversal from a zero-liquidity current tick.
      if (f === "top10")
        return out(abi, f, [
          Array.from({ length: 10 }, (_, i) =>
            i < state.awards
              ? i === 2
                ? wallet
                : "0x" + (i + 10).toString(16).padStart(40, "0")
              : zeroAddress,
          ),
          Array.from({ length: 10 }, (_, i) =>
            i < state.awards ? BigInt(1000 - i * 75) * 10n ** 18n : 0n,
          ),
        ]);
      if (f === "multiplierEndsAt") return out(abi, f, BigInt(state.end));
      if (f === "decimals") return out(abi, f, 18);
      if (f === "symbol") return out(abi, f, "PNTS");
      if (f === "BUY_RATE") return out(abi, f, 10000n);
      if (f === "SELL_RATE") return out(abi, f, 5000n);
      if (f === "LAUNCH_MULTIPLIER") return out(abi, f, 2n);
      if (f === "pointsOf") return out(abi, f, 250n * 10n ** 18n);
      if (f === "balanceOf") return out(abi, f, state.tokenBalance);
      if (f === "allowance") return out(abi, f, state.allowance);
      if (f === "approve") return out(abi, f, true);
      if (f === "quoteExactInputSingle") {
        if (state.quoteDelay)
          await new Promise((r) => setTimeout(r, state.quoteDelay));
        if (state.quoteError)
          throw Error("execution reverted: insufficient liquidity");
        assert.equal(args[0].hookData, "0x" + "0".repeat(24) + wallet.slice(2));
        return out(abi, f, [
          args[0].zeroForOne
            ? args[0].exactAmount * 1000000n
            : args[0].exactAmount / 1000000n,
          100000n,
        ]);
      }
      if (f === "swap") {
        if (state.swapError) throw Error("execution reverted: price limit");
        const [key, p, settings, data] = args,
          amount = -p.amountSpecified;
        assert.equal(data, "0x" + "0".repeat(24) + wallet.slice(2));
        assert.equal(key.hooks.toLowerCase(), addresses.SwapPointsHook);
        assert.equal(settings.takeClaims, false);
        assert.equal(settings.settleUsingBurn, false);
        const d0 = p.zeroForOne ? -amount : amount / 1000000n,
          d1 = p.zeroForOne ? amount * 1000000n : -amount;
        return out(
          abi,
          f,
          BigInt.asIntN(256, (d0 << 128n) | BigInt.asUintN(128, d1)),
        );
      }
      throw Error("Unexpected call " + name + "." + f);
    }
    throw Error("Unexpected RPC " + method);
  }
  for (const rpcUrl of manifest.network.rpcUrls)
    await page.route(rpcUrl, async (route) => {
      const request = route.request().postDataJSON();
      try {
        const result = await rpc(request);
        await route.fulfill({
          json: { jsonrpc: "2.0", id: request.id, result },
        });
      } catch (e) {
        await route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: request.id,
            error: /reverted/.test(e.message)
              ? {
                  code: 3,
                  message: e.message,
                  data: encodeErrorResult({
                    abi: [
                      {
                        type: "error",
                        name: "Error",
                        inputs: [{ name: "message", type: "string" }],
                      },
                    ],
                    errorName: "Error",
                    args: [e.message],
                  }),
                }
              : { code: -32000, message: e.message },
          },
        });
      }
    });
  await page.goto(url);
  await page
    .getByRole("heading", { name: "Small swaps. A few more points." })
    .waitFor();
  await page.getByText(/Updated at block/).waitFor();
  return { context, state };
}
async function connect() {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /Disconnect wallet/ }).waitFor();
}
async function quote(value = "0.001") {
  await page.getByLabel("You pay", { exact: true }).fill(value);
  await page.getByLabel("You pay", { exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").getAttribute("id"), "price-limit");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: /Review (buy|sell)/ }).waitFor();
}
try {
  let { context, state } = await setup({ wrongChain: true });
  await scenario(
    "Disconnected live reads, leaderboard and points events",
    async () => {
      assert.equal(await page.locator("tbody tr").count(), 10);
      assert.match(await page.locator(".activity-list").innerText(), /20 pts/);
      assert.equal(
        await page.locator(".stat").nth(1).locator("strong").innerText(),
        "— pts",
      );
    },
  );
  await scenario("Keyboard skip link and focus", async () => {
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").innerText(), "Skip to content");
    await page.screenshot({ path: evidence + "/keyboard-focus.png" });
    report.screenshots.push("keyboard-focus.png");
    await page.keyboard.press("Enter");
  });
  await scenario(
    "Wrong chain → switch → 4902 add exact chain → switch again",
    async () => {
      await connect();
      await page.getByRole("button", { name: "Switch to Sepolia" }).click();
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .waitFor();
      const requests = await page.evaluate(() => window.__wallet.requests);
      assert.deepEqual(
        requests
          .filter((r) => r.method.startsWith("wallet_"))
          .map((r) => r.method),
        [
          "wallet_switchEthereumChain",
          "wallet_addEthereumChain",
          "wallet_switchEthereumChain",
        ],
      );
      assert.deepEqual(
        requests.find((r) => r.method === "wallet_addEthereumChain").params,
        [manifest.walletAddChain],
      );
    },
  );
  await scenario(
    "Input errors focus the field; excessive precision and insufficient balance blocked",
    async () => {
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      assert.equal(await page.locator(":focus").getAttribute("id"), "amount");
      assert.match(
        await page.locator("#field-error").innerText(),
        /positive amount/,
      );
      await page
        .getByLabel("You pay", { exact: true })
        .fill("0.0000000000000000001");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      assert.match(
        await page.locator("#field-error").innerText(),
        /18 decimal/,
      );
      await page.getByLabel("You pay", { exact: true }).fill("2");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await page.getByText(/Insufficient ETH balance/).waitFor();
      assert.equal(state.transactions.length, 0);
      await page.getByLabel("You pay", { exact: true }).fill("0.001");
      await page.getByLabel("Price movement limit", { exact: true }).fill("0");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      assert.equal(
        await page.locator(":focus").getAttribute("id"),
        "price-limit",
      );
      assert.equal(
        await page.locator("#price-limit").getAttribute("aria-invalid"),
        "true",
      );
      assert.equal(
        await page.locator("#amount").getAttribute("aria-invalid"),
        "false",
      );
      await page
        .getByLabel("Price movement limit", { exact: true })
        .fill("0.5");
    },
  );
  await scenario(
    "Native buy quote includes wallet hookData; simulation and direct router submission",
    async () => {
      await quote();
      assert.match(await page.locator(".quote-review").innerText(), /20 pts/);
      await page.getByRole("button", { name: "Confirm buy in wallet" }).click();
      await page
        .getByText("Swap confirmed. Refreshing your balances and points.")
        .waitFor();
      assert.equal(state.transactions.length, 1);
      const tx = state.transactions[0];
      assert.equal(tx.to.toLowerCase(), manifest.router.address);
      assert.equal(BigInt(tx.value), 10n ** 15n);
      const decoded = decodeFunctionData({
        abi: abis.PoolSwapTest,
        data: tx.data,
      });
      assert.equal(decoded.args[1].amountSpecified, -(10n ** 15n));
      assert(decoded.args[1].sqrtPriceLimitX96 < 1000n * 2n ** 96n);
    },
  );
  await scenario(
    "Sell requires exact PNTS approval then fresh quote then swap",
    async () => {
      await page
        .getByRole("button", { name: "Sell PNTS", exact: true })
        .click();
      await quote("1000");
      await page.getByRole("button", { name: "Approve 1,000 PNTS" }).click();
      await page
        .getByText("PNTS approval confirmed. Get a fresh quote to swap.")
        .waitFor();
      assert.equal(state.allowance, 1000n * 10n ** 18n);
      await quote("1000");
      await page
        .getByRole("button", { name: "Confirm sell in wallet" })
        .click();
      await page
        .getByText("Swap confirmed. Refreshing your balances and points.")
        .waitFor();
      assert.equal(state.transactions.length, 3);
      assert.equal(BigInt(state.transactions[2].value || 0), 0n);
    },
  );
  await scenario(
    "Wallet rejection and simulation failure show recovery; no failed broadcast",
    async () => {
      await page.getByRole("button", { name: "Buy PNTS", exact: true }).click();
      await quote();
      await page.evaluate(() => (window.__wallet.rejectSend = true));
      await page.getByRole("button", { name: "Confirm buy in wallet" }).click();
      await page
        .getByText("Request declined in your wallet. You can try again.")
        .waitFor();
      assert.equal(state.transactions.length, 3);
      await page.evaluate(() => (window.__wallet.rejectSend = false));
      state.swapError = true;
      await quote();
      await page.getByRole("button", { name: "Confirm buy in wallet" }).click();
      await page
        .locator(".transaction-messages .error")
        .filter({ hasText: /reverted|contract function/ })
        .waitFor();
      assert.equal(state.transactions.length, 3);
      state.swapError = false;
    },
  );
  await scenario("Account and chain changes invalidate quotes", async () => {
    await quote();
    await page.evaluate((address) => {
      window.__wallet.account = address;
      window.__wallet.emit("accountsChanged", [address]);
    }, alternate);
    await page
      .getByRole("heading", { name: "Review buy" })
      .waitFor({ state: "detached" });
    await page.evaluate((address) => {
      window.__wallet.account = address;
      window.__wallet.emit("accountsChanged", [address]);
    }, wallet);
    await page.getByText(/Updated at block/).waitFor();
    await quote();
    await page.evaluate(() => {
      window.__wallet.chain = "0x1";
      window.__wallet.emit("chainChanged", "0x1");
    });
    await page.getByRole("button", { name: "Switch to Sepolia" }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Review buy" }).count(),
      0,
    );
    await page.getByRole("button", { name: "Switch to Sepolia" }).click();
  });
  await scenario("Expired quotes disable confirmation", async () => {
    await quote();
    await page.clock.fastForward(31000);
    await page.getByText("Expired — refresh quote").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Confirm buy in wallet" })
        .isDisabled(),
      true,
    );
    await page.clock.resume();
  });
  await scenario(
    "Desktop / mobile / intermediate reflow, axe and reduced motion",
    async () => {
      await page.getByRole("button", { name: /Disconnect wallet/ }).click();
      for (const width of [1440, 820, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `Overflow at ${width}`,
        );
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          scan.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
          [],
        );
        await page.screenshot({
          path: evidence + `/mock-${width}.png`,
          fullPage: true,
        });
        report.screenshots.push(`mock-${width}.png`);
      }
      assert.equal(
        await page
          .locator(".primary")
          .evaluate((e) => getComputedStyle(e).transitionDuration),
        "0s",
      );
      report.contrast = await page.evaluate(() => {
        const lum = (c) => {
          const a = c
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map((n) => +n / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            );
          return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
        };
        return [".primary", ".intro-copy", ".label", ".panel"].map(
          (selector) => {
            const el = document.querySelector(selector),
              cs = getComputedStyle(el);
            let node = el,
              bg = cs.backgroundColor;
            while (bg === "rgba(0, 0, 0, 0)" && node.parentElement) {
              node = node.parentElement;
              bg = getComputedStyle(node).backgroundColor;
            }
            const a = lum(cs.color),
              b = lum(bg);
            return {
              selector,
              foreground: cs.color,
              background: bg,
              ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            };
          },
        );
      });
      await page.setViewportSize({ width: 820, height: 1000 });
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "200%"),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    },
  );
  await context.close();
  ({ context, state } = await setup({ noWallet: true, empty: true }));
  await scenario("Missing wallet and empty states", async () => {
    await page.getByRole("button", { name: "Connect wallet to swap" }).click();
    await page.getByText(/No browser wallet found/).waitFor();
    await page.getByText("The board is open.").waitFor();
    assert.equal(state.transactions.length, 0);
  });
  await context.close();
  ({ context, state } = await setup());
  await connect();
  await scenario(
    "Missing contract code blocks actions, then recovers",
    async () => {
      state.missingCode = true;
      await page.getByRole("button", { name: /Refresh data/ }).click();
      await page.getByText(/No contract code at/).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Get quote", exact: true })
          .isDisabled(),
        true,
      );
      state.missingCode = false;
      await page.getByRole("button", { name: /Refresh data/ }).click();
      await page.getByText(/Updated at block/).waitFor();
    },
  );
  await scenario("Wrong RPC chain blocks actions", async () => {
    state.wrongRpc = true;
    await page.getByRole("button", { name: /Refresh data/ }).click();
    await page.getByText(/RPC chain does not match/).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .isDisabled(),
      true,
    );
  });
  await context.close();
  ({ context, state } = await setup());
  await scenario("Tampered ABI fails closed", async () => {
    await page.route("**/abi/Points.json", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.reload();
    await page
      .getByRole("heading", { name: "Unable to load the deployment" })
      .waitFor();
    await page.getByText(/ABI integrity check failed/).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Get quote" }).count(),
      0,
    );
  });
  await context.close();
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.resourceFailures, []);
  report.result = "passed";
} catch (e) {
  report.result = "failed";
  report.error = e.stack;
  console.error(e);
  if (page && !page.isClosed())
    await page.screenshot({ path: evidence + "/failure.png", fullPage: true });
  process.exitCode = 1;
} finally {
  await writeFile(
    evidence + "/browser-results.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
  await new Promise((r) => server.close(r));
}
