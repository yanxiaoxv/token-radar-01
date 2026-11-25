// Token Radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out. Every number on the board is derived from the snapshot's own figures; no protocol
// name is special-cased and no row is hand-picked.
//
// Where radar-1 priced every protocol at one flat share of its TVL, radar-2 asks the snapshot
// what a token is actually worth per dollar of TVL in the protocol's own category:
//
//   peers      = the live-token protocols in the same category (a token and a market cap on
//                record, TVL above zero); each peer's multiple is mcap_usd / tvl_usd
//   multiple   = the category's median peer multiple, shrunk toward the snapshot-wide median
//                by the peer count (weight n / (n + SHRINK_K)) and clamped to a sane band, so a
//                category with one wild peer cannot price a whole board row at 400x
//   momentum   = 1 + MOMENTUM_WEIGHT * tanh(change_7d / MOMENTUM_SCALE): a bounded read of the
//                seven-day TVL change, so a +4,000% print cannot outrank a balance sheet
//   maturity   = MATURITY_FLOOR + MATURITY_RANGE * ln(1 + age_days) / ln(1 + MATURITY_DAYS):
//                a log curve in the days since DefiLlama first tracked the protocol; a launch
//                is likelier from a protocol that has run for years with no token than from
//                one listed last month, and the curve flattens instead of rewarding age forever
//   breadth    = 1 + BREADTH_PER_CHAIN * min(chains - 1, BREADTH_MAX_CHAINS): a protocol live
//                on many chains has more surfaces a token can be dropped across
//   implied    = max(1, round(tvl_usd * multiple * breadth * momentum * maturity))
//
// The board row's model.base_multiple carries multiple * breadth (the full share of TVL the
// model applies before momentum and maturity), so the starter identity
// implied = tvl * base_multiple * growth_multiplier * maturity_multiplier still holds per row.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// an early radar below the floor: pre-token protocols the house's own watchlist rules would
// recognise as launch candidates (no token, not a wrapped/staked/bridged product of another
// protocol, not an exchange, not a versioned pool), ranked by implied value and capped. The
// snapshot's live-token protocols are kept apart and shown at the market's own values.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** radar-2's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
  momentum_weight: number;
  momentum_scale: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  multiple_floor: 0.04,
  multiple_cap: 2.5,
  momentum_weight: 0.45,
  momentum_scale: 30,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 6,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many early-radar protocols below the watchlist floor the board carries, by implied value. */
export const EARLY_ROWS = 180;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's peer evidence: how many live peers priced it, and at what multiple. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  median: number;
  effective: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  peer_multiple: number;
  breadth_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the peer evidence and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The peer evidence: for every category, the live-token protocols that price it. A peer is a
 * protocol with a token on record, a market cap above zero and TVL above zero. The effective
 * multiple shrinks the category median toward the snapshot-wide median by peer count and is
 * clamped, so thin or wild categories land near the global read instead of at an outlier.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, CategoryMultiple> } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, list] of ratios) {
    const med = median(list);
    const shrunk = (list.length * med + model.shrink_k * global) / (list.length + model.shrink_k);
    byCategory.set(category, {
      category,
      peers: list.length,
      median: med,
      effective: Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk)),
    });
  }
  return { global, byCategory };
}

/** The multiple one protocol is priced at: its category's effective multiple, else the global. */
function multipleFor(p: SnapshotProtocol, peers: { global: number; byCategory: Map<string, CategoryMultiple> }): number {
  const entry = peers.byCategory.get(p.category ?? 'Other');
  return entry === undefined ? peers.global : entry.effective;
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  peers: { global: number; byCategory: Map<string, CategoryMultiple> },
): { implied: number; growthPct: number; momentumMult: number; maturityMult: number; breadthMult: number; multiple: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = multipleFor(protocol, peers);
  const growthPct = finite(protocol.change_7d, 0);
  const momentumMult = 1 + model.momentum_weight * Math.tanh(growthPct / model.momentum_scale);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + model.maturity_range * Math.min(1, Math.log1p(Math.max(ageForModel, 0)) / Math.log1p(model.maturity_days));
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * breadthMult * momentumMult * maturityMult));
  return { implied, growthPct, momentumMult, maturityMult, breadthMult, multiple, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of another asset or venue, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Names that begin with an exchange's name: the exchange's own product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word that marks a wrapped or staked product of another protocol's asset. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a pre-token protocol is a launch candidate in the house's own sense: not a versioned
 * pool, not a wrapped, staked or bridged product, not an exchange's own page. The watchlist rows
 * are carried regardless; this rule only shapes the early radar below the floor.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = peerMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: launch candidates below the watchlist floor, strongest implied value first,
  // capped. A chosen protocol stays chosen: the early radar never displaces a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isLaunchCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, model, peers).implied }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const { p } of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, peers) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: round4(s.multiple * s.breadthMult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.momentumMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** A rough gas budget for one transaction on a chain, from the chain's own fee level. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $12 of gas at a quiet hour';
  if (chain === 'Solana' || chain === 'Near' || chain === 'Sui' || chain === 'Aptos') return 'well under $1 of gas';
  if (chain === 'Bitcoin') return 'about $2 of fees';
  return 'about $3 of gas';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}; if it offers borrowing, take one small USDC loan against the position and repay it a week later so both sides of the market see the wallet.`;
  if (c.includes('dex')) return `Swap about $${Math.max(25, Math.round(capital / 2))} through ${name}'s busiest pair on ${chain}, then provide $${capital} of liquidity to that pool and keep the position open.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity manager')) return `Deposit $${capital} into ${name}'s main vault or pool on ${chain} and leave auto-compounding on if it offers it.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into one of ${name}'s curated vaults on ${chain} and keep the vault shares in the wallet.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it after a day so the wallet records a full trade cycle.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} after its onboarding check, and hold the asset in the wallet.`;
  if (c.includes('basis')) return `Open ${name}'s basis position with $${capital} on ${chain}, following its own deposit flow, and keep it open.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position on each side of a liquid market on ${name}, so the wallet shows real trading, not a single bet.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('stable') || c.includes('algo')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it rather than swapping out at once.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for the shortest term it sells and keep the policy to expiry.`;
  if (c.includes('launchpad')) return `Register the wallet on ${name} and join one open sale or waitlist round with about $${capital} ready to commit.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it in the wallet.`;
  if (c.includes('payment')) return `Route one real payment of about $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name} and make one swap and one transfer there in the same week, so the wallet is a real user of the chain.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The second surface: another chain when the protocol has one, else a second action at home. */
function secondSurfaceFor(p: SnapshotProtocol, capital: number): string {
  const name = p.name;
  if (p.chains.length >= 2) {
    const second = p.chains[1]!;
    return `Repeat a smaller version on ${second}: about $${Math.max(25, Math.round(capital / 2))} through ${name} there, so the wallet is active on two of its ${p.chains.length} chains, not just the cheapest one.`;
  }
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return `Open a second market on ${name}: supply a different asset than the first deposit, so the wallet is not a one-market user.`;
  if (c.includes('dex')) return `Trade a second pair on ${name} once, a small swap of about $25, so the wallet's history is more than one pool.`;
  return `Use one more of ${name}'s own features once (a second vault, a vote, or its referral page), so the wallet reads as a user, not a single deposit.`;
}

/** The weekly cadence action, by category. */
function cadenceFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Repay and redraw a small loan, or top the supply up by a few dollars, once a week on ${name}.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('farm')) return `Make one small swap or rebalance on ${name} each week, even $10, so no week in the window is silent.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Open and close one small position on ${name} each week; volume over time is what its snapshots record.`;
  return `Make one qualifying action on ${name} each week: a deposit, a claim, a vote or a small trade, never the same minute each time.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Start from a fresh wallet that holds only the funds for this farm; keep its seed phrase offline and fund it with the gas token of ${chain} first.`,
      cost: 'under $5 to fund and make the first transaction',
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: secondSurfaceFor(p, capital),
      cost: `about $${Math.max(25, Math.round(capital / 2))} of capital and ${gasFor(p.chains[1] ?? chain)}`,
      time: '15 minutes',
    },
    {
      text: cadenceFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days and put two calendar reminders inside the window, so the activity spans more than one activity snapshot instead of a single weekend.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open ${p.name}'s own points or rewards page, link the wallet if it offers one, and claim only from links the protocol itself publishes; never pay a fee to claim and never sign a claim from a search result or a direct message.`,
      cost: 'nothing to check; a claim that asks for a fee is a scam',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log with the wallet, the chain, the dates and the transaction hashes, and note how the position unwinds, so you can exit in minutes if the protocol is hacked, pauses withdrawals or announces a snapshot you want to be inside.`,
      cost: 'nothing but the log',
      time: '5 minutes, then 1 minute a week',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>, multiple: number, breadth: number): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    peer_multiple: multiple,
    breadth_multiplier: breadth,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  // The dashboard recomputes every row's implied value in the page and compares it with the
  // board's, so data.js carries the two factors board.json folds into base_multiple at full
  // precision: the category's effective peer multiple and the chain-breadth multiplier.
  const index = bySlug(snapshot.protocols);
  const rows = board.map((row) => {
    const p = index.get(row.slug)!;
    const f = impliedValue(p, snapshot.as_of, model, peers);
    return radarRow(row, watchlist, f.multiple, f.breadthMult);
  });
  const multiples = [...peers.byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global),
    multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
