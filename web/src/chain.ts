import {
  createWalletClient,
  custom,
  zeroAddress,
  type Address,
  type Hash,
  type AbiEvent,
} from "viem";
import { publicClient, type Config, type Provider } from "./config";
import { poolId, poolKey, hookData, deltas, priceLimit } from "./math";

export function errorMessage(e: unknown): string {
  const err = e as {
    code?: number;
    shortMessage?: string;
    message?: string;
    cause?: unknown;
  };
  if (
    err?.code === 4001 ||
    /rejected|denied/i.test(err?.shortMessage ?? err?.message ?? "")
  )
    return "Request declined in your wallet. You can try again.";
  let nested = e as {
    cause?: unknown;
    details?: string;
    reason?: string;
    shortMessage?: string;
    message?: string;
  };
  let detail = "";
  for (let depth = 0; nested && depth < 8; depth++) {
    if (nested.reason) {
      detail = nested.reason;
      break;
    }
    if (nested.details && !/https?:|Contract Call:/.test(nested.details))
      detail = nested.details;
    nested = nested.cause as typeof nested;
  }
  const message = (
    detail ||
    err?.shortMessage ||
    err?.message ||
    "Request failed."
  ).slice(0, 280);
  return `${message} Try a smaller amount, refresh the quote, or check your connection.`;
}
export async function switchChain(provider: Provider, config: Config) {
  const chainId = config.deployment.walletAddChain.chainId;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (e) {
    const err = e as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      err.code !== 4902 &&
      err.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(err.message ?? "")
    )
      throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [config.deployment.walletAddChain],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
}
export interface Quote {
  account: Address;
  buy: boolean;
  amount: bigint;
  amountOut: bigint;
  limit: bigint;
  bps: number;
  created: number;
  allowance: bigint;
  block: bigint;
}
export function createService(config: Config, provider?: Provider) {
  const client = publicClient(config, provider);
  const { deployment: d, hook, token, abis } = config;
  const id = poolId(config),
    key = poolKey(config);
  const router = { address: d.router.address, abi: abis.PoolSwapTest };
  const view = { address: d.network.uniswapV4.stateView, abi: abis.StateView };
  const readHook = (
    functionName: string,
    args: readonly unknown[] = [],
    blockNumber?: bigint,
  ) => client.readContract({ ...hook, functionName, args, blockNumber });
  async function verify() {
    if ((await client.getChainId()) !== d.chainId)
      throw Error(
        "RPC chain does not match the deployment. Swaps are disabled.",
      );
    const addresses = [
      token.address,
      hook.address,
      d.network.uniswapV4.poolManager,
      view.address,
      d.network.uniswapV4.quoter,
      router.address,
    ];
    await Promise.all(
      addresses.map(async (address) => {
        if (!(await client.getCode({ address }))?.replace(/^0x/, "").length)
          throw Error(`No contract code at ${address}. Swaps are disabled.`);
      }),
    );
    const [hookManager, routerManager] = await Promise.all([
      readHook("poolManager"),
      client.readContract({ ...router, functionName: "manager" }),
    ]);
    if (
      [hookManager, routerManager].some(
        (a) =>
          String(a).toLowerCase() !==
          d.network.uniswapV4.poolManager.toLowerCase(),
      )
    )
      throw Error("PoolManager binding does not match the deployment.");
  }
  async function state(account?: Address) {
    const block = await client.getBlock();
    const blockNumber = block.number;
    const [
      slot,
      liquidity,
      board,
      end,
      decimals,
      symbol,
      buyRate,
      sellRate,
      multiplier,
      points,
      tokenBalance,
      ethBalance,
      allowance,
    ] = await Promise.all([
      client.readContract({
        ...view,
        functionName: "getSlot0",
        args: [id],
        blockNumber,
      }) as Promise<readonly [bigint, number, number, number]>,
      client.readContract({
        ...view,
        functionName: "getLiquidity",
        args: [id],
        blockNumber,
      }) as Promise<bigint>,
      readHook("top10", [id], blockNumber) as Promise<
        readonly [readonly Address[], readonly bigint[]]
      >,
      readHook("multiplierEndsAt", [id], blockNumber) as Promise<bigint>,
      client.readContract({
        ...token,
        functionName: "decimals",
        blockNumber,
      }) as Promise<number>,
      client.readContract({
        ...token,
        functionName: "symbol",
        blockNumber,
      }) as Promise<string>,
      readHook("BUY_RATE", [], blockNumber) as Promise<bigint>,
      readHook("SELL_RATE", [], blockNumber) as Promise<bigint>,
      readHook("LAUNCH_MULTIPLIER", [], blockNumber) as Promise<bigint>,
      account
        ? (readHook("pointsOf", [id, account], blockNumber) as Promise<bigint>)
        : 0n,
      account
        ? (client.readContract({
            ...token,
            functionName: "balanceOf",
            args: [account],
            blockNumber,
          }) as Promise<bigint>)
        : 0n,
      account ? client.getBalance({ address: account, blockNumber }) : 0n,
      account
        ? (client.readContract({
            ...token,
            functionName: "allowance",
            args: [account, router.address],
            blockNumber,
          }) as Promise<bigint>)
        : 0n,
    ]);
    if (
      decimals !== d.token.decimals ||
      symbol !== d.token.symbol ||
      key.currency0 !== zeroAddress
    )
      throw Error("Token or pool metadata differs from the deployment.");
    return {
      block: blockNumber,
      timestamp: Number(block.timestamp),
      fetched: Date.now(),
      slot,
      liquidity,
      board: board[0]
        .map((address, i) => ({ address, points: board[1][i] }))
        .filter((a) => a.address !== zeroAddress),
      end: Number(end),
      decimals,
      symbol,
      buyRate,
      sellRate,
      multiplier,
      points,
      tokenBalance,
      ethBalance,
      allowance,
    };
  }
  async function events() {
    const latest = await client.getBlockNumber();
    const start = latest > 1999n ? latest - 1999n : 0n;
    const fromBlock =
      start > BigInt(d.deploymentBlock) ? start : BigInt(d.deploymentBlock);
    const event = hook.abi.find(
      (item) => item.type === "event" && item.name === "Points",
    ) as AbiEvent;
    if (!event) throw Error("Points event missing from the verified ABI.");
    const logs = await client.getLogs({
      address: hook.address,
      event,
      args: { poolId: id },
      fromBlock,
      toBlock: latest,
    });
    return {
      fromBlock,
      toBlock: latest,
      logs: logs
        .filter((l) => !l.removed)
        .reverse()
        .slice(0, 8)
        .map((l) => ({
          hash: l.transactionHash!,
          index: l.logIndex,
          user: (l.args as Record<string, unknown>).user as Address,
          earned: (l.args as Record<string, unknown>).earned as bigint,
          total: (l.args as Record<string, unknown>).total as bigint,
          block: l.blockNumber!,
        })),
    };
  }
  async function session(account: Address) {
    if (!provider) throw Error("Connect a browser wallet to continue.");
    const [chain, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    if (Number(chain) !== d.chainId)
      throw Error(`Switch to ${d.network.name} to continue.`);
    if (accounts[0]?.toLowerCase() !== account.toLowerCase())
      throw Error("Wallet account changed. Request a new quote.");
    return createWalletClient({
      chain: config.chain,
      account,
      transport: custom(provider),
    });
  }
  async function quote(
    account: Address,
    buy: boolean,
    amount: bigint,
    basisPoints: number,
  ) {
    await session(account);
    await verify();
    const current = await state(account);
    if (!current.slot[0] || !current.end)
      throw Error(
        "This pool is not initialized. Try again when the pool is available.",
      );
    if (amount > (buy ? current.ethBalance : current.tokenBalance))
      throw Error(
        `Insufficient ${buy ? "ETH" : current.symbol} balance. Reduce the amount.`,
      );
    const zeroForOne = buy;
    const result = await client.simulateContract({
      address: d.network.uniswapV4.quoter,
      abi: abis.Quoter,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: key,
          zeroForOne,
          exactAmount: amount,
          hookData: hookData(account),
        },
      ],
      account,
    });
    const [amountOut] = result.result as readonly [bigint, bigint];
    if (amountOut <= 0n)
      throw Error("The quote returned no output. Try a different amount.");
    return {
      account,
      buy,
      amount,
      amountOut,
      limit: priceLimit(current.slot[0], buy, basisPoints),
      bps: basisPoints,
      created: Date.now(),
      allowance: current.allowance,
      block: current.block,
    } satisfies Quote;
  }
  function fresh(q: Quote) {
    if (Date.now() - q.created > 30000)
      throw Error("Quote expired. Request a new quote before continuing.");
  }
  async function approve(q: Quote, sent: (hash: Hash) => void) {
    fresh(q);
    const wallet = await session(q.account);
    await verify();
    const { request } = await client.simulateContract({
      ...token,
      functionName: "approve",
      args: [router.address, q.amount],
      account: q.account,
    });
    await session(q.account);
    fresh(q);
    const hash = await wallet.writeContract(request);
    sent(hash);
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 180000,
    });
    if (receipt.status !== "success")
      throw Error("Approval reverted. Check the transaction and try again.");
    return receipt;
  }
  async function swap(q: Quote, sent: (hash: Hash) => void) {
    fresh(q);
    const wallet = await session(q.account);
    await verify();
    const { request, result } = await client.simulateContract({
      ...router,
      functionName: "swap",
      args: [
        key,
        {
          zeroForOne: q.buy,
          amountSpecified: -q.amount,
          sqrtPriceLimitX96: q.limit,
        },
        { takeClaims: false, settleUsingBurn: false },
        hookData(q.account),
      ],
      value: q.buy ? q.amount : 0n,
      account: q.account,
    });
    const [d0, d1] = deltas(result as bigint);
    const input = q.buy ? -d0 : -d1,
      output = q.buy ? d1 : d0;
    if (input <= 0n || input > q.amount || output <= 0n)
      throw Error(
        "Swap simulation produced no usable output. Request a new quote.",
      );
    // A preview check, not an on-chain minimum-output guarantee. PoolSwapTest only enforces sqrtPriceLimitX96.
    if (
      output * q.amount * 10000n <
      q.amountOut * input * BigInt(10000 - q.bps)
    )
      throw Error(
        "Simulated execution moved beyond the quote tolerance. Request a new quote.",
      );
    await session(q.account);
    fresh(q);
    const hash = await wallet.writeContract(request);
    sent(hash);
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 180000,
    });
    if (receipt.status !== "success")
      throw Error(
        "Swap reverted. Check the transaction and request a new quote.",
      );
    return receipt;
  }
  return { client, verify, state, events, quote, approve, swap };
}
export type State = Awaited<
  ReturnType<ReturnType<typeof createService>["state"]>
>;
export type Events = Awaited<
  ReturnType<ReturnType<typeof createService>["events"]>
>;
