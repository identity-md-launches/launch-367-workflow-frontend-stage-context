import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, stringToHex, parseAbi } from "viem";

const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(",")}}`;
const handoff = JSON.parse(await readFile("config/handoff.json", "utf8"));
const { network, walletAddChain } = JSON.parse(
  await readFile("config/network.json", "utf8"),
);
const router = JSON.parse(await readFile("config/router.json", "utf8"));
if (
  network.chainId !== handoff.chainId ||
  Number(walletAddChain.chainId) !== handoff.chainId
)
  throw Error("Chain mismatch");
await mkdir("../dist/abi", { recursive: true });
const contracts = [];
for (const { name, address, abiHash } of handoff.contracts) {
  const path = `docs/abi/${name}.json`;
  const pinned = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:${path}`],
    { cwd: "..", encoding: "utf8" },
  );
  const abi = JSON.parse(pinned);
  if (
    !Array.isArray(abi) ||
    keccak256(stringToHex(canonical(abi))).slice(2) !== abiHash
  )
    throw Error(`ABI hash mismatch: ${name}`);
  if (
    canonical(JSON.parse(await readFile(`../${path}`, "utf8"))) !==
    canonical(abi)
  )
    throw Error(`Working ABI differs from pinned commit: ${name}`);
  const abiPath = `abi/${name}.json`;
  await writeFile(`../dist/${abiPath}`, JSON.stringify(abi) + "\n");
  contracts.push({ name, address, abiHash, abiPath });
  console.log(`Verified ${name}: ${abiHash}`);
}
const key =
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }";
const interfaces = {
  StateView: parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
    "function poolManager() view returns (address)",
  ]),
  PoolSwapTest: parseAbi([
    key,
    "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
    "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
    "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)",
    "function manager() view returns (address)",
  ]),
  Quoter: parseAbi([
    key,
    "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
    "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  ]),
};
const interfaceRefs = [];
for (const [name, abi] of Object.entries(interfaces)) {
  const abiPath = `abi/${name}.json`;
  await writeFile(`../dist/${abiPath}`, JSON.stringify(abi) + "\n");
  interfaceRefs.push({
    name,
    abiPath,
    abiHash: keccak256(stringToHex(canonical(abi))).slice(2),
  });
}
const assets = [];
async function walk(dir = "") {
  for (const entry of (
    await readdir(`../dist/${dir}`, { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = dir + entry.name;
    if (entry.isDirectory()) await walk(path + "/");
    else if (path !== "imd-deployment.json") {
      if ((await stat(`../dist/${path}`)).size > 8388608)
        throw Error("Oversize asset");
      assets.push({
        path,
        sha256: createHash("sha256")
          .update(await readFile(`../dist/${path}`))
          .digest("hex"),
      });
    }
  }
}
await walk();
if (assets.length > 128) throw Error("Too many assets");
const { version, launchId, chainId, sourceCommit, attestationHash } = handoff;
const manifest = {
  version,
  launchId,
  chainId,
  sourceCommit,
  attestationHash,
  contracts,
  assets,
  network,
  walletAddChain,
  pool: handoff.manifest.pool,
  token: handoff.manifest.token,
  deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
  router,
  interfaces: interfaceRefs,
};
await writeFile(
  "../dist/imd-deployment.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Export manifest: ${assets.length} hashed assets`);
