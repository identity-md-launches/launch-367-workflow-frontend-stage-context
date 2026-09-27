import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { formatUnits, type Address, type Hash } from "viem";
import type { Config } from "./config";
import {
  createService,
  errorMessage,
  switchChain,
  type State,
  type Events,
  type Quote,
} from "./chain";
import { bps, format, inputAmount, poolId, timeLeft } from "./math";
const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
export default function App({ config }: { config: Config }) {
  const { deployment: d } = config;
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [provider, setProvider] = useState(window.ethereum);
  const service = useMemo(
    () => createService(config, provider),
    [config, provider],
  );
  const [data, setData] = useState<State>();
  const [events, setEvents] = useState<Events>();
  const [readError, setReadError] = useState("");
  const [eventError, setEventError] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [fieldTarget, setFieldTarget] = useState("amount");
  const [status, setStatus] = useState("");
  const [tx, setTx] = useState<Hash>();
  const [pending, setPending] = useState<Hash>();
  const generation = useRef(0);
  const amountRef = useRef<HTMLInputElement>(null),
    priceRef = useRef<HTMLInputElement>(null);
  const correctChain = walletChain === d.chainId;
  const invalidate = useCallback(() => {
    generation.current++;
    setQuote(undefined);
    setError("");
    setFieldError("");
  }, []);
  useEffect(() => {
    const p = provider;
    if (!p) return;
    const accountsChanged = (accounts: Address[]) => {
      invalidate();
      setData(undefined);
      setAccount(accounts[0]);
    };
    const chainChanged = (chain: string) => {
      invalidate();
      setWalletChain(Number(chain));
    };
    const disconnected = () => {
      invalidate();
      setAccount(undefined);
      setWalletChain(undefined);
    };
    p.on?.("accountsChanged", accountsChanged);
    p.on?.("chainChanged", chainChanged);
    p.on?.("disconnect", disconnected);
    return () => {
      p.removeListener?.("accountsChanged", accountsChanged);
      p.removeListener?.("chainChanged", chainChanged);
      p.removeListener?.("disconnect", disconnected);
    };
  }, [provider, invalidate]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let canceled = false,
      inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        await service.verify();
        const state = await service.state(account);
        if (!canceled) {
          setData(state);
          setReady(true);
          setReadError("");
        }
      } catch (e) {
        if (!canceled) {
          setReadError(errorMessage(e));
          setReady(false);
          setQuote(undefined);
        }
      } finally {
        if (!canceled) setLoading(false);
        inFlight = false;
      }
    }
    async function awards() {
      try {
        const result = await service.events();
        if (!canceled) {
          setEvents(result);
          setEventError("");
        }
      } catch (e) {
        if (!canceled) {
          setEvents(undefined);
          setEventError(errorMessage(e));
        }
      }
    }
    void load();
    void awards();
    const timer = setInterval(() => {
      void load();
      void awards();
    }, 20000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [service, account, refresh]);
  async function connect() {
    const p = window.ethereum;
    if (!p) {
      setError(
        "No browser wallet found. Install an Ethereum browser wallet, then reload this page.",
      );
      return;
    }
    setProvider(p);
    setBusy("Connecting");
    setError("");
    try {
      const accounts = await p.request({ method: "eth_requestAccounts" });
      if (!accounts[0])
        throw Error(
          "No wallet account selected. Open your wallet and try again.",
        );
      setAccount(accounts[0]);
      setWalletChain(Number(await p.request({ method: "eth_chainId" })));
      invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function switchNetwork() {
    if (!provider) return;
    setBusy("Switching network");
    setError("");
    try {
      await switchChain(provider, config);
      setWalletChain(Number(await provider.request({ method: "eth_chainId" })));
      invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function getQuote(event: FormEvent) {
    event.preventDefault();
    if (!account || !correctChain || !ready || busy || pending) return;
    setError("");
    setFieldError("");
    setStatus("");
    setQuote(undefined);
    let parsed: bigint, tolerance: number;
    try {
      parsed = inputAmount(
        amount,
        buy ? d.network.nativeCurrency.decimals : data!.decimals,
      );
    } catch (e) {
      setFieldTarget("amount");
      setFieldError(errorMessage(e));
      amountRef.current?.focus();
      return;
    }
    try {
      tolerance = bps(limit);
    } catch (e) {
      setFieldTarget("price-limit");
      setFieldError(errorMessage(e));
      priceRef.current?.focus();
      return;
    }
    const request = ++generation.current;
    setBusy("Getting quote");
    try {
      const next = await service.quote(account, buy, parsed, tolerance);
      if (request === generation.current) {
        setQuote(next);
        setStatus("Quote ready. Review the estimate and price limit below.");
      }
    } catch (e) {
      if (request === generation.current) setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function transact(approval: boolean) {
    if (!quote || !account || !correctChain || !ready || busy || pending)
      return;
    setError("");
    setTx(undefined);
    setBusy(approval ? "Approving PNTS" : "Simulating swap");
    setStatus(
      approval
        ? "Approve only this PNTS amount in your wallet."
        : "Checking execution before your wallet confirmation…",
    );
    let broadcast = false;
    try {
      const onSent = (hash: Hash) => {
        broadcast = true;
        setTx(hash);
        setPending(hash);
        setStatus("Transaction submitted. Waiting for confirmation…");
        setBusy("Waiting for confirmation");
      };
      await (approval
        ? service.approve(quote, onSent)
        : service.swap(quote, onSent));
      setPending(undefined);
      setQuote(undefined);
      setRefresh((r) => r + 1);
      setStatus(
        approval
          ? "PNTS approval confirmed. Get a fresh quote to swap."
          : "Swap confirmed. Refreshing your balances and points.",
      );
    } catch (e) {
      setError(errorMessage(e));
      setQuote(undefined);
      setStatus(
        broadcast
          ? "Check the transaction status before starting another swap."
          : "No transaction submitted. Get a fresh quote to retry.",
      );
    } finally {
      setBusy("");
    }
  }
  async function checkPending() {
    if (!pending) return;
    setBusy("Checking transaction");
    try {
      const receipt = await service.client.getTransactionReceipt({
        hash: pending,
      });
      setPending(undefined);
      setError("");
      setQuote(undefined);
      setRefresh((r) => r + 1);
      setStatus(
        receipt.status === "success"
          ? "Transaction confirmed. Get a new quote to continue."
          : "Transaction reverted. Get a new quote to retry.",
      );
    } catch {
      setError(
        "Confirmation is not available yet. Check the explorer, then try again.",
      );
    } finally {
      setBusy("");
    }
  }
  const now = data
    ? data.timestamp + Math.floor((clock - data.fetched) / 1000)
    : 0;
  const active = !!data?.end && now < data.end;
  const fresh = !!quote && clock - quote.created <= 30000;
  const stale = !data || clock - data.fetched > 60000;
  const canAct =
    ready && !stale && account && correctChain && !busy && !pending;
  const price = data?.slot[0]
    ? (Number(data.slot[0]) ** 2 / 2 ** 192) *
      10 ** (d.network.nativeCurrency.decimals - data.decimals)
    : undefined;
  const explorer = (kind: string, value: string) =>
    `${d.network.explorer}/${kind}/${value}`;
  const inputSymbol = buy ? "ETH" : d.token.symbol,
    outputSymbol = buy ? d.token.symbol : "ETH";
  const estimatedPoints =
    quote && data
      ? (buy ? quote.amount * data.buyRate : quote.amountOut * data.sellRate) *
        (active ? data.multiplier : 1n)
      : undefined;
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header shell">
        <a className="brand" href="#main" aria-label="Points Lab home">
          <span className="brand-mark" aria-hidden="true">
            p<span>·</span>
          </span>
          <span>
            points<span className="brand-sub"> / lab</span>
          </span>
        </a>
        <div className="header-actions">
          <span className="network-label">
            <span className="dot" />
            {d.network.name} testnet
          </span>
          {account ? (
            <button
              className="wallet-button"
              disabled={!!busy}
              onClick={() => {
                invalidate();
                setAccount(undefined);
                setData(undefined);
                setStatus("Wallet disconnected from this page.");
              }}
              aria-label={`Disconnect wallet ${account}`}
            >
              {short(account)} <span aria-hidden="true">×</span>
            </button>
          ) : (
            <button
              className="wallet-button"
              disabled={!!busy}
              onClick={connect}
            >
              Connect wallet <Arrow />
            </button>
          )}
        </div>
      </header>
      <main id="main" className="shell">
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Experiment 001 · Uniswap v4</p>
            <h1 id="page-title">
              Small swaps.
              <br />
              <span>A few more points.</span>
            </h1>
            <p className="intro-copy">
              Explore an on-chain rewards experiment. Swap Sepolia ETH and PNTS,
              collect points, and watch the leaderboard.
            </p>
          </div>
          <div className="experiment-stamp" aria-hidden="true">
            <div className="stamp-grid">
              {Array.from({ length: 16 }, (_, i) => (
                <i key={i} className={i > 10 ? "faded" : ""} />
              ))}
            </div>
            <span>Every swap leaves a point.</span>
          </div>
        </section>
        <div className="test-notice">
          <span className="notice-label">Just an experiment</span>
          <span>
            Test tokens and points have no value. No rewards or returns are
            promised.
          </span>
        </div>
        <section className="stats" aria-label="Pool overview">
          <div className="stat">
            <span className="label">Pool price</span>
            <strong>
              {price !== undefined
                ? new Intl.NumberFormat("en-US", {
                    maximumFractionDigits: 2,
                  }).format(price)
                : "—"}{" "}
              <small>PNTS / ETH</small>
            </strong>
            <span className="subtle">
              {data ? "From Uniswap StateView" : "Waiting for live pool data"}
            </span>
          </div>
          <div className="stat">
            <span className="label">Your points</span>
            <strong>
              {account && data ? format(data.points) : "—"} <small>pts</small>
            </strong>
            <span className="subtle">
              {account
                ? "Non-transferable · 18 decimal places"
                : "Connect a wallet to see your score"}
            </span>
          </div>
          <div className="stat multiplier">
            <div className="stat-heading">
              <span className="label">Launch multiplier</span>
              <span className="pill">
                {data
                  ? active
                    ? "2× active"
                    : data.end
                      ? "1× now"
                      : "Not started"
                  : "Checking"}
              </span>
            </div>
            <strong className="timer">
              {data
                ? data.end
                  ? timeLeft(data.end, now)
                  : "Awaiting pool"
                : "—"}
            </strong>
            <span className="subtle">
              {active
                ? "Double points in the first 7 days"
                : "Buy: 10 pts / 0.001 ETH · Sell: 5 pts"}
            </span>
          </div>
        </section>
        <div className="sync-line">
          <span>
            {loading
              ? "Reading Sepolia…"
              : readError
                ? "Live reads unavailable — swaps disabled"
                : stale
                  ? "Data is stale — refresh to continue"
                  : `Updated at block ${data?.block.toString() ?? "—"}`}
          </span>
          <button
            className="text-button"
            disabled={loading}
            onClick={() => setRefresh((r) => r + 1)}
          >
            Refresh data <span aria-hidden="true">↻</span>
          </button>
        </div>
        {readError && (
          <div role="alert" className="error read-error">
            {readError} Use Refresh data to retry.
          </div>
        )}
        <div className="workspace">
          <section className="swap-panel panel" aria-labelledby="swap-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Make a move</p>
                <h2 id="swap-title">Swap & collect</h2>
              </div>
              <span className="round-icon" aria-hidden="true">
                ↔
              </span>
            </div>
            <div className="segments" role="group" aria-label="Swap direction">
              <button
                aria-pressed={buy}
                disabled={!!busy || !!pending}
                onClick={() => {
                  setBuy(true);
                  setAmount("");
                  invalidate();
                }}
              >
                Buy PNTS
              </button>
              <button
                aria-pressed={!buy}
                disabled={!!busy || !!pending}
                onClick={() => {
                  setBuy(false);
                  setAmount("");
                  invalidate();
                }}
              >
                Sell PNTS
              </button>
            </div>
            <form onSubmit={getQuote}>
              <div className="amount-box">
                <label htmlFor="amount">You pay</label>
                <div className="amount-entry">
                  <input
                    id="amount"
                    ref={amountRef}
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    disabled={!!busy || !!pending}
                    aria-invalid={!!fieldError && fieldTarget === "amount"}
                    aria-describedby="amount-hint field-error"
                    onChange={(e) => {
                      setAmount(e.target.value);
                      invalidate();
                    }}
                  />
                  <span className="token-pill">
                    <span className="token-icon" aria-hidden="true">
                      {buy ? "◇" : "p"}
                    </span>
                    {inputSymbol}
                  </span>
                </div>
                <p id="amount-hint" className="subtle">
                  Balance:{" "}
                  {account && data
                    ? `${format(buy ? data.ethBalance : data.tokenBalance, buy ? 18 : data.decimals)} ${inputSymbol}`
                    : "Connect wallet"}
                </p>
              </div>
              <div className="receive">
                <span className="label">Estimated receive</span>
                <strong>
                  {quote
                    ? format(quote.amountOut, buy ? data?.decimals : 18)
                    : "—"}{" "}
                  <span>{outputSymbol}</span>
                </strong>
              </div>
              <div className="price-limit">
                <label htmlFor="price-limit">Price movement limit</label>
                <div>
                  <input
                    ref={priceRef}
                    id="price-limit"
                    name="price-limit"
                    inputMode="decimal"
                    autoComplete="off"
                    value={limit}
                    disabled={!!busy || !!pending}
                    aria-invalid={!!fieldError && fieldTarget === "price-limit"}
                    aria-describedby="limit-help field-error"
                    onChange={(e) => {
                      setLimit(e.target.value);
                      invalidate();
                    }}
                  />
                  <span>%</span>
                </div>
              </div>
              <p className="subtle limit-help" id="limit-help">
                Caps the pool’s ending price movement. This test router can
                partially fill a swap and has no minimum-output or deadline
                guarantee.
              </p>
              <p id="field-error" className="error" role="alert">
                {fieldError}
              </p>
              {!account ? (
                <button
                  type="button"
                  className="primary"
                  onClick={connect}
                  disabled={!!busy}
                >
                  {busy || "Connect wallet to swap"} <Arrow />
                </button>
              ) : !correctChain ? (
                <>
                  <p className="network-warning">
                    Your wallet is on another network.
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={switchNetwork}
                    disabled={!!busy}
                  >
                    Switch to {d.network.name}
                  </button>
                </>
              ) : (
                <button className="primary" type="submit" disabled={!canAct}>
                  {busy || (quote ? "Refresh quote" : "Get quote")} <Arrow />
                </button>
              )}
              {account && correctChain && (!ready || stale) && (
                <p className="subtle">
                  Live deployment and pool checks must pass before swapping.
                </p>
              )}
            </form>
            {quote && (
              <div className="quote-review" aria-label="Swap review">
                <h3>Review {buy ? "buy" : "sell"}</h3>
                <dl>
                  <div>
                    <dt>Spend up to</dt>
                    <dd>
                      {formatUnits(quote.amount, buy ? 18 : data!.decimals)}{" "}
                      {inputSymbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Estimated points</dt>
                    <dd>+{format(estimatedPoints ?? 0n)} pts</dd>
                  </div>
                  <div>
                    <dt>Price limit</dt>
                    <dd>{quote.bps / 100}% from quoted spot</dd>
                  </div>
                  <div>
                    <dt>Quote</dt>
                    <dd>
                      {fresh
                        ? `${Math.max(0, 30 - Math.floor((clock - quote.created) / 1000))}s remaining`
                        : "Expired — refresh quote"}
                    </dd>
                  </div>
                </dl>
                <p className="subtle">
                  Points use the ETH amount actually settled. Gas is extra. Your
                  connected wallet receives the tokens and is credited in
                  hookData.
                </p>
                {!buy && quote.allowance < quote.amount ? (
                  <>
                    <p className="subtle">
                      Step 1 of 2: allow PoolSwapTest to spend this PNTS amount.
                      Then get a fresh quote for the swap.
                    </p>
                    <button
                      className="secondary full"
                      disabled={!canAct || !fresh}
                      onClick={() => transact(true)}
                    >
                      Approve {format(quote.amount, data!.decimals)} PNTS
                    </button>
                  </>
                ) : (
                  <button
                    className="secondary full"
                    disabled={!canAct || !fresh}
                    onClick={() => transact(false)}
                  >
                    Confirm {buy ? "buy" : "sell"} in wallet
                  </button>
                )}
              </div>
            )}
            <div className="transaction-messages">
              <p role="status">{status}</p>
              <p role="alert" className="error">
                {error}
              </p>
              {tx && (
                <a href={explorer("tx", tx)} target="_blank" rel="noreferrer">
                  View transaction <Arrow />
                </a>
              )}
              {pending && !busy && (
                <button className="secondary full" onClick={checkPending}>
                  Check confirmation
                </button>
              )}
            </div>
            <div className="swap-foot">
              <span>Pool fee {d.pool.fee / 10000}%</span>
              <span>No hook fee</span>
            </div>
          </section>
          <section
            className="leaderboard panel"
            aria-labelledby="leaderboard-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">On the board</p>
                <h2 id="leaderboard-title">The top ten</h2>
              </div>
              <span className="outline-pill">On-chain</span>
            </div>
            <p className="section-copy">
              A little friendly competition. Points stay with each address, and
              earlier entries win ties.
            </p>
            <table>
              <caption className="sr-only">
                Top ten wallets ranked by earned points
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Wallet</th>
                  <th scope="col">Points</th>
                </tr>
              </thead>
              <tbody>
                {data?.board.map((entry, index) => (
                  <tr
                    key={entry.address}
                    className={
                      entry.address.toLowerCase() === account?.toLowerCase()
                        ? "you"
                        : ""
                    }
                  >
                    <td>
                      <span className={index === 0 ? "rank first" : "rank"}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td>
                      <a
                        href={explorer("address", entry.address)}
                        title={entry.address}
                        aria-label={`Wallet ${entry.address}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(entry.address)}
                      </a>
                      {entry.address.toLowerCase() ===
                        account?.toLowerCase() && (
                        <span className="you-label">You</span>
                      )}
                    </td>
                    <td title={formatUnits(entry.points, 18)}>
                      {format(entry.points, 18, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!data || data.board.length === 0) && (
              <div className="empty">
                <div className="empty-dots" aria-hidden="true">
                  •••
                </div>
                <h3>
                  {data ? "The board is open." : "Waiting for the board."}
                </h3>
                <p>
                  {data
                    ? "Make a swap to put your address here."
                    : "Rankings will appear when the live read completes."}
                </p>
              </div>
            )}
            <div className="board-note">
              <span aria-hidden="true">↳</span> Scores are read directly from
              the hook’s top10 view.
            </div>
          </section>
        </div>
        <section className="activity" aria-labelledby="activity-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Straight from the hook</p>
              <h2 id="activity-title">Recent points</h2>
            </div>
            <span className="subtle">Latest 2,000 blocks · up to 8 awards</span>
          </div>
          {eventError ? (
            <p className="error">
              Award history could not load. Refresh data to retry. {eventError}
            </p>
          ) : events?.logs.length ? (
            <div className="activity-list">
              {events.logs.map((log) => (
                <a
                  className="activity-row"
                  key={`${log.hash}-${log.index}`}
                  href={explorer("tx", log.hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    <span className="award-dot" aria-hidden="true">
                      +
                    </span>
                    <span title={log.user}>{short(log.user)}</span>
                  </span>
                  <span className="subtle">Block {log.block.toString()}</span>
                  <strong>
                    +{format(log.earned, 18, 3)} pts <Arrow />
                  </strong>
                </a>
              ))}
            </div>
          ) : (
            <p className="activity-empty">
              {events
                ? "No point awards in this block range. The next credited swap will show up here."
                : "Loading recent Points events…"}
            </p>
          )}
        </section>
        <section className="about">
          <div>
            <p className="eyebrow">The rules are simple</p>
            <h2>
              Trade a little.
              <br />
              Learn a little.
            </h2>
          </div>
          <div className="about-copy">
            <p>
              Buy with 0.001 ETH to earn 10 points. Sell for 0.001 ETH to earn
              5. Both rates double during the pool’s first seven days.
            </p>
            <p>
              Points are separate from PNTS tokens. They cannot be transferred
              or redeemed. Anyone can credit any address through unauthenticated
              hookData, and round trips can farm points at the cost of pool fees
              and gas.
            </p>
            <a href={d.network.faucets[0]} target="_blank" rel="noreferrer">
              Get Sepolia test ETH <Arrow />
            </a>
          </div>
        </section>
        <details className="deployment-details">
          <summary>Explore the deployment</summary>
          <dl>
            <div>
              <dt>Pool ID</dt>
              <dd>
                <code>{poolId(config)}</code>
              </dd>
            </div>
            {d.contracts.map((c) => (
              <div key={c.name}>
                <dt>{c.name}</dt>
                <dd>
                  <a
                    href={explorer("address", c.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {c.address} <Arrow />
                  </a>
                </dd>
              </div>
            ))}
            {[
              ["PoolSwapTest", d.router.address],
              ["StateView", d.network.uniswapV4.stateView],
              ["Quoter", d.network.uniswapV4.quoter],
              ["PoolManager", d.network.uniswapV4.poolManager],
            ].map(([name, address]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <a
                    href={explorer("address", address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {address} <Arrow />
                  </a>
                </dd>
              </div>
            ))}
            <div>
              <dt>Wallet</dt>
              <dd>{account ?? "Not connected"}</dd>
            </div>
            <div>
              <dt>Deployed source</dt>
              <dd>
                <code>{d.sourceCommit}</code>
              </dd>
            </div>
          </dl>
          <a href="./imd-deployment.json">
            View deployment manifest <Arrow />
          </a>
        </details>
      </main>
      <footer className="shell footer">
        <span>points / lab</span>
        <span>A Sepolia test toy. Nothing here promises a return.</span>
        <a href={d.router.source} target="_blank" rel="noreferrer">
          Uniswap deployments <Arrow />
        </a>
      </footer>
    </>
  );
}
