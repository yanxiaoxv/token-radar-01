# Token Radar (model radar-2)

A pre-token protocol board for the make.fun **token-radar-01** bounty ($1,325 in USDC):
every protocol in a frozen DefiLlama snapshot that has no token on record, ranked by the
value a token could plausibly carry — priced the way its own category already trades.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. The program writes `board.json` (the ranked board),
`data.js`, a static `dashboard/` (no framework, no network), `screenshots/` (the board, a
protocol detail and a filtered view) and `dossier.json`, the judge's summary built with
`vendor/makefun-board.ts`.

## The model

One function scores every row from the snapshot's own figures; no name is special-cased.

- **Peer multiple** — for each category, the median market-cap/TVL ratio of its live-token
  protocols in the same snapshot, shrunk toward the snapshot-wide median by peer count
  (weight n / (n + 6)) and clamped to 0.04x–2.50x, so one wild peer cannot price a category.
- **Momentum** — 1 + 0.45 · tanh(change_7d / 30): a bounded read of the seven-day TVL move.
- **Maturity** — a log curve in the days since DefiLlama first tracked the protocol.
- **Breadth** — +3% per extra chain, up to six: more surfaces a token can be dropped across.

The board covers all 40 watchlist slugs (the floor, never a ceiling) and adds an early
radar of launch candidates below the $50M floor: no token on record, and not a wrapped,
staked or bridged product of another protocol, not an exchange's own page, not a versioned
pool. Every row carries a seven-step farm plan derived from its category, chains, TVL and
age — the action, its cost and its time.

## Files

- `main.ts` — the entry: parse, score, verify, write, dossier last.
- `lib/model.ts` — the radar-2 model, the board builder and the farm-plan derivation.
- `dashboard/` — the static page; it recomputes every row in the browser and compares it
  with `board.json`, and regenerates the farm plans with the same derivation.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored byte for byte.
