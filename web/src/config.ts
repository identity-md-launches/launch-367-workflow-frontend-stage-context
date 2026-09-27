import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  custom,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
import { abiHash, localPath } from "./integrity";

export type Provider = EIP1193Provider & {
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export interface Deployment {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  interfaces: { name: string; abiHash: string; abiPath: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<
      | "poolManager"
      | "stateView"
      | "quoter"
      | "universalRouter"
      | "positionManager"
      | "permit2",
      Address
    >;
  };
  walletAddChain: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: {
    pairedCurrency: Address;
    fee: number;
    tickSpacing: number;
    initialPrice: string;
  };
  token: { name: string; symbol: string; decimals: number; contract: string };
  router: { name: string; address: Address; source: string };
  deploymentBlock: number;
}
export async function loadDeployment() {
  const response = await fetch(
    new URL("imd-deployment.json", document.baseURI),
    { cache: "no-store" },
  );
  if (!response.ok)
    throw Error("Deployment could not load. Reload the page to retry.");
  const deployment: Deployment = await response.json();
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId ||
    Number(deployment.walletAddChain.chainId) !== deployment.chainId ||
    deployment.contracts.length !== 2 ||
    !deployment.network.testnet
  )
    throw Error(
      "Deployment configuration is inconsistent. Swaps are disabled.",
    );
  const abis: Record<string, Abi> = {};
  await Promise.all(
    [...deployment.contracts, ...deployment.interfaces].map(
      async (contract) => {
        const path = localPath(contract.abiPath);
        if (!deployment.assets.some((a) => a.path === path))
          throw Error("ABI missing from asset inventory.");
        const res = await fetch(new URL(path, document.baseURI));
        if (!res.ok)
          throw Error(`Cannot load ${contract.name} ABI. Reload to retry.`);
        const abi: Abi = await res.json();
        if (!Array.isArray(abi) || abiHash(abi) !== contract.abiHash)
          throw Error(
            `${contract.name} ABI integrity check failed. Swaps are disabled.`,
          );
        abis[contract.name] = abi;
      },
    ),
  );
  const contract = (name: string) => {
    const c = deployment.contracts.find((c) => c.name === name);
    if (!c) throw Error(`Deployment is missing ${name}.`);
    return { address: c.address, abi: abis[name] };
  };
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: deployment.network.explorer },
    },
    testnet: deployment.network.testnet,
  });
  return {
    deployment,
    abis,
    chain,
    token: contract(deployment.token.contract),
    hook: contract("SwapPointsHook"),
  };
}
export type Config = Awaited<ReturnType<typeof loadDeployment>>;
export function publicClient(config: Config, provider?: Provider) {
  return createPublicClient({
    chain: config.chain,
    transport: fallback(
      [
        ...config.deployment.network.rpcUrls.map((url) =>
          http(url, { timeout: 7000, retryCount: 0 }),
        ),
        ...(provider
          ? [
              custom(
                {
                  request: async (args) => {
                    if (
                      Number(
                        await provider.request({ method: "eth_chainId" }),
                      ) !== config.chain.id
                    )
                      throw Error("Wallet is on another chain.");
                    return provider.request(
                      args as Parameters<Provider["request"]>[0],
                    );
                  },
                },
                { retryCount: 0 },
              ),
            ]
          : []),
      ],
      { retryCount: 0 },
    ),
  });
}
