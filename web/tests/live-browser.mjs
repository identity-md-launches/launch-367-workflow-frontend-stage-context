import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
const root = resolve("../dist"),
  evidence = resolve("../docs/evidence");
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/preview/")) throw Error();
    const name = path.slice(9) || "index.html";
    if (name.includes("..")) throw Error();
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[extname(name)] || "application/octet-stream",
    );
    res.end(await readFile(root + "/" + name));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = {
  checkedAt: new Date().toISOString(),
  consoleErrors: [],
  failedRequests: [],
  checks: [],
};
page.on("pageerror", (e) => report.consoleErrors.push(e.message));
page.on("console", (e) => {
  if (e.type() === "error") report.consoleErrors.push(e.text());
});
page.on("requestfailed", (r) =>
  report.failedRequests.push({ url: r.url(), error: r.failure() }),
);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page
    .getByText(/Updated at block|Live reads unavailable/)
    .waitFor({ timeout: 45000 });
  report.liveReadStatus = await page.locator(".sync-line").innerText();
  report.body = await page.locator(".stats").innerText();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    report.checks.push({
      width,
      scrollWidth: await page.evaluate(
        () => document.documentElement.scrollWidth,
      ),
    });
    await page.screenshot({
      path: evidence + `/live-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Connect wallet to swap" }).click();
  await page.getByText(/No browser wallet found/).waitFor();
  report.missingWallet = "passed";
  report.snapshot = await page.locator("body").ariaSnapshot();
  report.result = "completed";
} catch (e) {
  report.result = "failed";
  report.error = String(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    evidence + "/live-browser.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
  await new Promise((r) => server.close(r));
}
console.log(JSON.stringify({ ...report, snapshot: undefined }, null, 2));
