import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const m = JSON.parse(await readFile("../dist/imd-deployment.json", "utf8"));
const h = JSON.parse(await readFile("config/handoff.json", "utf8"));
const n = JSON.parse(await readFile("config/network.json", "utf8"));
for (const field of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.equal(m[field], h[field]);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
assert.deepEqual(
  m.contracts.map(({ abiPath, ...c }) => c),
  h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })),
);
const files = [];
let total = 0;
async function walk(dir = "") {
  for (const e of await readdir("../dist/" + dir, { withFileTypes: true })) {
    const path = dir + e.name;
    if (e.isDirectory()) await walk(path + "/");
    else if (path !== "imd-deployment.json") files.push(path);
  }
}
await walk();
assert.deepEqual(files.sort(), m.assets.map((a) => a.path).sort());
assert(files.includes("index.html"));
assert(files.length <= 128);
for (const asset of m.assets) {
  assert(/^[a-zA-Z0-9_./-]+$/.test(asset.path));
  assert(!asset.path.startsWith("/") && !asset.path.split("/").includes(".."));
  const raw = await readFile("../dist/" + asset.path);
  assert(raw.length <= 8388608);
  total += raw.length;
  assert.equal(createHash("sha256").update(raw).digest("hex"), asset.sha256);
}
assert(total < 24 * 1024 * 1024);
assert((await readFile("../dist/index.html", "utf8")).includes("./assets/"));
console.log(
  JSON.stringify(
    {
      passed: true,
      assets: files.length,
      exportBytes: total + (await stat("../dist/imd-deployment.json")).size,
      networkUnchanged: true,
      contractsMatch: true,
    },
    null,
    2,
  ),
);
