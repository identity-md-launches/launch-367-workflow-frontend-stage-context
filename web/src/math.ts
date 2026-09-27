import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  parseUnits,
  formatUnits,
  type Address,
} from "viem";
import type { Config } from "./config";
export const keyType = parseAbiParameters(
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
);
export function poolKey(c: Config) {
  const currencies = [c.deployment.pool.pairedCurrency, c.token.address].sort(
    (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  return {
    currency0: currencies[0],
    currency1: currencies[1],
    fee: c.deployment.pool.fee,
    tickSpacing: c.deployment.pool.tickSpacing,
    hooks: c.hook.address,
  };
}
export const poolId = (c: Config) =>
  keccak256(encodeAbiParameters(keyType, [poolKey(c)]));
export const hookData = (address: Address) =>
  encodeAbiParameters([{ type: "address" }], [address]);
export function inputAmount(value: string, decimals: number) {
  if (
    !/^(?:\d+\.?\d*|\.\d+)$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount > (1n << 127n) - 1n)
    throw Error("Enter an amount greater than zero and within the pool limit.");
  return amount;
}
export function bps(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw Error(
      "Use a price limit from 0.1% to 5%, with up to two decimal places.",
    );
  const n = Math.round(Number(value) * 100);
  if (n < 10 || n > 500) throw Error("Use a price limit from 0.1% to 5%.");
  return n;
}
export function sqrt(n: bigint): bigint {
  if (n < 0n) throw Error("Negative square root");
  if (n < 2n) return n;
  let x = n,
    y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
export function priceLimit(
  current: bigint,
  zeroForOne: boolean,
  basisPoints: number,
) {
  const squared = current * current;
  // Limit terminal spot-price deterioration, with conservative integer rounding.
  const limit = zeroForOne
    ? sqrt((squared * BigInt(10000 - basisPoints)) / 10000n) + 1n
    : sqrt((squared * 10000n) / BigInt(10000 - basisPoints));
  const min = 4295128740n,
    max = 1461446703485210103287273052203988822378723970341n;
  if (
    limit <= min ||
    limit >= max ||
    (zeroForOne ? limit >= current : limit <= current)
  )
    throw Error("Price is outside the supported swap range.");
  return limit;
}
export function deltas(packed: bigint) {
  return [
    BigInt.asIntN(128, packed >> 128n),
    BigInt.asIntN(128, packed),
  ] as const;
}
export function format(value: bigint, decimals = 18, places = 5) {
  const raw = formatUnits(value, decimals);
  if (value > 0n && Number(raw) < 10 ** -places) return `<${10 ** -places}`;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: places,
  }).format(Number(raw));
}
export function timeLeft(end: number, now: number) {
  const seconds = Math.max(0, end - now);
  const days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  return seconds
    ? `${days}d ${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m ${Math.floor(
        seconds % 60,
      )
        .toString()
        .padStart(2, "0")}s`
    : "Window ended";
}
