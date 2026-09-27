import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inputAmount,
  bps,
  priceLimit,
  deltas,
  hookData,
  timeLeft,
} from "../src/math";
import { abiHash, localPath } from "../src/integrity";
import { switchChain } from "../src/chain";
import type { Config, Provider } from "../src/config";

test("ABI canonical hashes match attested deployment", async () => {
  const manifest = JSON.parse(
    await readFile("../dist/imd-deployment.json", "utf8"),
  );
  for (const c of manifest.contracts)
    assert.equal(
      abiHash(JSON.parse(await readFile(`../dist/${c.abiPath}`, "utf8"))),
      c.abiHash,
    );
  assert.equal(abiHash([{ b: 2, a: 1 }]), abiHash([{ a: 1, b: 2 }]));
});
test("Amounts preserve wei and reject excessive precision, scientific notation and negatives", () => {
  assert.equal(inputAmount("0.000000000000000001", 18), 1n);
  assert.equal(inputAmount("1.25", 6), 1250000n);
  for (const s of ["0", "-1", "1e3", "Infinity", "0.0000000000000000001", ""])
    assert.throws(() => inputAmount(s, 18));
  assert.equal(bps("0.5"), 50);
  for (const s of ["0", "5.01", "-1", "0.111"]) assert.throws(() => bps(s));
});
test("Price limits are directional and conservative; packed signed deltas survive", () => {
  const p = 1000n * 2n ** 96n;
  const buy = priceLimit(p, true, 50),
    sell = priceLimit(p, false, 50);
  assert(buy < p && sell > p);
  assert(buy * buy * 10000n >= p * p * 9950n);
  assert(sell * sell * 9950n <= p * p * 10000n);
  const input = 10n ** 15n,
    output = 1000n * 10n ** 18n;
  assert.deepEqual(deltas(BigInt.asIntN(256, (-input << 128n) | output)), [
    -input,
    output,
  ]);
  assert.deepEqual(deltas((input << 128n) | BigInt.asUintN(128, -output)), [
    input,
    -output,
  ]);
});
test("hookData encodes exactly one wallet; countdown ends exactly at boundary", () => {
  const address = "0x1111111111111111111111111111111111111111";
  assert.equal(hookData(address), `0x${"0".repeat(24)}${address.slice(2)}`);
  assert.equal(timeLeft(100, 99), "0d 00h 00m 01s");
  assert.equal(timeLeft(100, 100), "Window ended");
});
test("Manifest paths reject traversal and URL schemes", () => {
  assert.equal(localPath("abi/Points.json"), "abi/Points.json");
  for (const s of [
    "../Points.json",
    "/x",
    "https://evil/x",
    "abi//x",
    "abi/./x",
    "abi/%2e%2e/x",
  ])
    assert.throws(() => localPath(s));
});
test("Unknown chain adds exact supplied parameters and switches again; rejection never adds", async () => {
  const network = JSON.parse(await readFile("config/network.json", "utf8"));
  const config = {
    deployment: { walletAddChain: network.walletAddChain },
  } as Config;
  const calls: any[] = [];
  await switchChain(
    {
      request: async (request: any) => {
        calls.push(request);
        if (calls.length === 1) throw { code: 4902 };
      },
    } as Provider,
    config,
  );
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [network.walletAddChain]);
  let attempts = 0;
  await assert.rejects(
    switchChain(
      {
        request: async () => {
          attempts++;
          throw { code: 4001 };
        },
      } as Provider,
      config,
    ),
  );
  assert.equal(attempts, 1);
});
