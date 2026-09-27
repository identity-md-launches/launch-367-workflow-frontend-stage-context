import { keccak256, stringToHex } from "viem";

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export const abiHash = (abi: unknown) =>
  keccak256(stringToHex(canonical(abi))).slice(2);
export function localPath(path: string) {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((p) => p === ".." || p === "." || !p)
  )
    throw new Error("Deployment contains an unsafe asset path.");
  return path;
}
