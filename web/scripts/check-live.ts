import { readFile, writeFile } from "node:fs/promises";
import { defineChain, type Abi } from "viem";
import { createService } from "../src/chain";
import { poolId, poolKey, hookData } from "../src/math";
import type { Config, Deployment } from "../src/config";
const deployment: Deployment = JSON.parse(
  await readFile("../dist/imd-deployment.json", "utf8"),
);
const abis: Record<string, Abi> = {};
for (const item of [...deployment.contracts, ...deployment.interfaces])
  abis[item.name] = JSON.parse(
    await readFile(`../dist/${item.abiPath}`, "utf8"),
  );
const contract = (name: string) => ({
  address: deployment.contracts.find((c) => c.name === name)!.address,
  abi: abis[name],
});
const config: Config = {
  deployment,
  abis,
  chain: defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
  }),
  token: contract("Points"),
  hook: contract("SwapPointsHook"),
};
const service = createService(config);
const result: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  sourceCommit: deployment.sourceCommit,
  poolId: poolId(config),
  broadcastTransactions: false,
};
try {
  await service.verify();
  result.chainAndCode = "passed";
  result.contractCodeBytes = Object.fromEntries(
    await Promise.all(
      [
        ...deployment.contracts,
        { name: "PoolSwapTest", address: deployment.router.address },
        ...Object.entries(deployment.network.uniswapV4)
          .filter(([name]) =>
            ["stateView", "quoter", "poolManager"].includes(name),
          )
          .map(([name, address]) => ({ name, address })),
      ].map(async (c) => [
        c.name,
        ((await service.client.getCode({ address: c.address }))!.length - 2) /
          2,
      ]),
    ),
  );
  result.state = await service.state();
  result.quotes = [];
  for (const [buy, amount] of [
    [true, 10n ** 15n],
    [false, 1000n * 10n ** 18n],
  ] as const) {
    try {
      const quote = await service.client.simulateContract({
        address: deployment.network.uniswapV4.quoter,
        abi: abis.Quoter,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: poolKey(config),
            zeroForOne: buy,
            exactAmount: amount,
            hookData: hookData("0x1111111111111111111111111111111111111111"),
          },
        ],
      });
      (result.quotes as unknown[]).push({ buy, amount, result: quote.result });
    } catch (e) {
      (result.quotes as unknown[]).push({ buy, amount, error: String(e) });
    }
  }
  try {
    result.events = await service.events();
  } catch (e) {
    result.eventsError = String(e);
  }
} catch (e) {
  result.error = String(e);
  process.exitCode = 1;
}
await writeFile(
  "../docs/evidence/live-read.json",
  JSON.stringify(
    result,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    result,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
