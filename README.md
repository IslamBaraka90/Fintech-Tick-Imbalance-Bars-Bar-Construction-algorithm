# Fintech Tick-Imbalance Bars — Bar Construction Algorithm

> A canonical, well-specified, **cross-language (Python + TypeScript)** reference
> implementation of **Tick-Imbalance Bars** — the first *information-driven* bar
> type, where a bar closes when signed order-flow imbalance exceeds an
> **EWMA-adaptive threshold** — with a streaming builder that **exposes its
> learned state** and strict, auditable validation.

<p>
  <img alt="Python" src="https://img.shields.io/badge/python-3.10%2B-blue">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.7%2B-3178c6">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Tests" src="https://img.shields.io/badge/tests-31%20py%20%2F%2023%20ts-brightgreen">
</p>

**📖 Full article (canonical):** **[Tick-Imbalance Bars — The Fintech Builder](https://thefintechbuilder.com/market-data-engineering/bar-construction/tick-imbalance-bars/)**

This repository is the runnable, production-oriented companion to that article.
The article teaches the concept; this repo is the code you install and build on.

🧭 **Browse all algorithms:** [Awesome FinTech Algorithms](https://github.com/IslamBaraka90/Fintech-Algorithms-Awesome) — the full index of the library.
🗂️ **This algorithm's domain:** [Market Data Engineering](https://thefintechbuilder.com/domains/market-data-engineering/) › **Bar Construction**
↔️ **Sibling bar types:** [Time](https://github.com/IslamBaraka90/Fintech-Time-Bars-Bar-Construction-algorithm) · [Tick](https://github.com/IslamBaraka90/Fintech-Tick-Bars-Bar-Construction-algorithm) · [Volume](https://github.com/IslamBaraka90/Fintech-Volume-Bars-Bar-Construction-algorithm) · [Dollar](https://github.com/IslamBaraka90/Fintech-Dollar-Bars-Bar-Construction-algorithm).

| | |
|---|---|
| **Catalog topic** | `D01-F01-A05` |
| **Domain** | D01 — Market Data Engineering |
| **Family** | D01-F01 — Bar Construction |
| **Difficulty** | 4 / 5 |
| **Languages** | Python, TypeScript |

---

## Table of contents

- [What are Tick-Imbalance Bars?](#what-are-tick-imbalance-bars)
- [The tick rule](#the-tick-rule)
- [The adaptive threshold](#the-adaptive-threshold)
- [Why this implementation](#why-this-implementation)
- [Install](#install)
- [Quickstart](#quickstart)
- [Streaming, with observable state](#streaming-with-observable-state)
- [Loading a trade tape](#loading-a-trade-tape)
- [Config & bar shapes](#config--bar-shapes)
- [Worked example (exact)](#worked-example-exact)
- [API reference](#api-reference)
- [Edge cases & limitations](#edge-cases--limitations)
- [Testing](#testing)
- [Related algorithms](#related-algorithms)
- [License](#license)

---

## What are Tick-Imbalance Bars?

The bar types before this one sample on a *quantity you fix in advance* — a clock
interval, a trade count, share volume, notional. **Tick-imbalance bars** sample on
something the market decides: a bar closes when buying and selling pressure become
lopsided enough to be **surprising** relative to recent history.

```
imbalance = sum of tick signs in the bar
close the bar when  abs(imbalance) >= threshold
```

Because the threshold *adapts*, a run of one-sided trading closes bars quickly,
while balanced two-way flow lets a bar run long. This is the López de Prado
stopping idea (*Advances in Financial Machine Learning*), specialized here with
explicit seeds, a session reset, a threshold floor, and disclosed EMA updates.

## The tick rule

Every trade gets a sign from the price change alone (no venue-supplied side needed):

| price vs previous | sign |
|---|---|
| higher (uptick) | `+1` |
| lower (downtick) | `-1` |
| **unchanged (flat)** | **carries the preceding sign** — including across a bar boundary |
| first trade of a session | `initialTickSign` |

The flat rule is the subtle one: a flat trade is not zero and not a coin flip — it
inherits the last decisive direction, which is what keeps the imbalance a
continuous measure of pressure.

## The adaptive threshold

After every **threshold-closed** bar, two EWMAs update and the next threshold is
re-derived:

```
E[ticks]         ← (1 − alphaTicks)         · E[ticks]         + alphaTicks         · observedTicks
E[tickImbalance] ← (1 − alphaTickImbalance) · E[tickImbalance] + alphaTickImbalance · (imbalance / observedTicks)

threshold = max(thresholdFloor,  thresholdMultiplier · E[ticks] · abs(E[tickImbalance]))
```

Two deliberate guards:

- **Partial bars never learn.** A bar closed by `session_end` or `stream_end` is an
  artifact of where the tape stopped, not evidence about the process, so it does
  **not** move the expectations.
- **A floor.** `thresholdFloor` stops the threshold collapsing toward zero (which
  would emit a bar per trade) when the estimated imbalance drifts to ~0.

## Why this implementation

- **Faithful, disclosed convention** — seeds, floor, multiplier, and one-step EMA
  updates are all explicit config, not hidden constants.
- **Observable adaptation** — the streaming builder exposes `expected_ticks`,
  `expected_tick_imbalance`, `threshold`, `imbalance`, and `tick_sign` as it runs.
  Watching them is how you tell a mis-seeded threshold from a quiet tape.
- **Session-correct** — a session boundary resets previous price, tick sign, *and*
  both expectations back to their seeds.
- **Strict validation** through one `TickImbalanceBarsValidationError`.
- **Cross-language parity** — both suites assert the documented arithmetic: opening
  threshold `4`, completed bar (6 ticks, imbalance 4), post-close
  `E[ticks] = 7.5`, `E[imb] = 0.5833…`, next threshold `4.375`.

## Install

**Python**

```bash
pip install fintech-tick-imbalance-bars
```

**TypeScript / JavaScript (Node ≥ 20)**

```bash
npm install fintech-tick-imbalance-bars
```

## Quickstart

**Python**

```python
from fintech_tick_imbalance_bars import construct_bars

config = {
    "closePartial": True,
    "initialTickSign": 1,
    "initialExpectedTicks": 8,
    "initialExpectedTickImbalance": 0.5,
    "alphaTicks": 0.25,
    "alphaTickImbalance": 0.5,
    "thresholdFloor": 3,
    "thresholdMultiplier": 1,
}
bars = construct_bars(trades, config)
```

**TypeScript**

```ts
import { constructBars } from "fintech-tick-imbalance-bars";

const bars = constructBars(trades, config);
```

## Streaming, with observable state

```python
from fintech_tick_imbalance_bars import StreamingTickImbalanceBarBuilder

builder = StreamingTickImbalanceBarBuilder(config)
for trade in tape:
    for bar in builder.push(trade):
        publish(bar)
    # the adaptive state is inspectable at any moment:
    monitor(builder.imbalance, builder.threshold, builder.expected_ticks)
for bar in builder.flush():
    publish(bar)
```

Running the bundled example prints the threshold adapting in real time:

```
seed: E[ticks]=8 E[imb]=0.5 threshold=4
  closed on T6:  imbalance=4 >= 4      -> new E[ticks]=7.5000 threshold=4.3750
  closed on T11: imbalance=5 >= 4.375  -> new E[ticks]=6.8750 threshold=5.4427
```

## Loading a trade tape

Imbalance bars need **each execution's price** to assign a tick sign, so they are
built from a trade tape. Yahoo Finance does not expose tick data — only
pre-aggregated bars, where the signs are already lost — so there is no live Yahoo
source for this algorithm.

```python
from fintech_tick_imbalance_bars import construct_bars, load_trades

trades = load_trades("tape.csv")   # tradeId,timestamp,session,symbol,price,volume,currency
bars = construct_bars(trades, config)
```

> **Data note:** the committed fixtures are synthetic and prove the package
> arithmetic only. They are not a market episode or a predictive result.

## Config & bar shapes

**Config** (all required):

| Key | Meaning |
|---|---|
| `closePartial` | emit trailing partial bars at session/stream end |
| `initialTickSign` | `-1` or `+1`; sign for a session's first trade |
| `initialExpectedTicks` | positive seed for `E[ticks]` |
| `initialExpectedTickImbalance` | seed in `[-1, 1]` for `E[tickImbalance]` |
| `alphaTicks`, `alphaTickImbalance` | EWMA weights in `(0, 1]` |
| `thresholdFloor` | positive lower bound on the threshold |
| `thresholdMultiplier` | positive scale on the expectation product |

**Bar:** the usual OHLCV/audit fields plus **`imbalance`** and **`threshold`** —
the two numbers that explain why the bar closed when it did.

## Worked example (exact)

Config seeds `E[ticks] = 8`, `E[imb] = 0.5`, floor `3`, multiplier `1` ⇒ opening
threshold `max(3, 1 · 8 · 0.5) = 4`.

| # | price | sign | imbalance | decision |
|---|--:|--:|--:|---|
| W1 | 100.00 | +1 (seed) | 1 | open |
| W2 | 100.00 | +1 (flat carries) | 2 | open |
| W3 | 100.10 | +1 | 3 | open |
| W4 | 100.05 | −1 | 2 | open |
| W5 | 100.10 | +1 | 3 | open |
| W6 | 100.15 | +1 | **4** | **close** (4 ≥ 4) |

Post-close update: `E[ticks] = 0.75·8 + 0.25·6 = 7.5`,
`E[imb] = 0.5·0.5 + 0.5·(4/6) = 0.5833…`, so the **next** threshold is
`max(3, 7.5 · 0.5833…) = 4.375`. Continuing the tape closes a second bar at that
new threshold and leaves a 1-tick partial. All of these values are asserted by
**both** language test suites.

## API reference

| Purpose | Python | TypeScript |
|---|---|---|
| Batch construction | `construct_bars(trades, config)` | `constructBars(trades, config)` |
| Streaming builder | `StreamingTickImbalanceBarBuilder(config)` | `new StreamingTickImbalanceBarBuilder(config)` |
| Adaptive state | `.expected_ticks`, `.expected_tick_imbalance`, `.threshold`, `.imbalance`, `.tick_sign` | `.expectedTicks`, `.expectedTickImbalance`, `.threshold`, `.imbalance`, `.tickSign` |
| Load a trade tape | `load_trades(csv)` | `loadTrades(path)` |
| Errors | `TickImbalanceBarsValidationError` | `TickImbalanceBarsValidationError` |

## Edge cases & limitations

- **Seed sensitivity:** the first few bars are dominated by your seeds; treat early
  bars as burn-in.
- **Floor matters:** without `thresholdFloor`, an `E[imbalance]` near zero drives
  the threshold to zero and emits a bar per trade.
- **Not a predictor:** imbalance describes realized flow; a lopsided bar is not a
  forecast.
- **Sessions reset everything** — previous price, tick sign, and both expectations.
- **Finalized input only:** corrections resolved upstream; chronological, unique
  ids, one symbol and one currency per call.

## Testing

**Python** (31 tests)

```bash
cd python && pip install -e ".[dev]" && pytest
```

**TypeScript** (23 tests, zero runtime dependencies)

```bash
cd typescript && npm install && npm test && npm run build
```

## Related algorithms

- `D01-F01-A01…A04` — [Time](https://github.com/IslamBaraka90/Fintech-Time-Bars-Bar-Construction-algorithm) · [Tick](https://github.com/IslamBaraka90/Fintech-Tick-Bars-Bar-Construction-algorithm) · [Volume](https://github.com/IslamBaraka90/Fintech-Volume-Bars-Bar-Construction-algorithm) · [Dollar](https://github.com/IslamBaraka90/Fintech-Dollar-Bars-Bar-Construction-algorithm) bars
- `D01-F01-A06` — Volume-Imbalance Bars · `A07` — Tick-Run Bars
- `D07-F01-A02` — [EMA](https://github.com/IslamBaraka90/Fintech-EMA-Exponential-Moving-Average-algorithm) (the smoothing behind the adaptive threshold)

Full index: **[Awesome FinTech Algorithms](https://github.com/IslamBaraka90/Fintech-Algorithms-Awesome)**.

## License

[MIT](./LICENSE) © The Fintech Builder. Part of the
[100 FinTech Algorithms](https://thefintechbuilder.com) library.
