/**
 * Quickstart: Tick-Imbalance Bars, batch and streaming (with adaptive state).
 *
 * Run:  node --experimental-strip-types examples/quickstart.ts
 */

import { constructBars, type Config, type Trade } from "../src/bars.ts";
import { StreamingTickImbalanceBarBuilder } from "../src/streaming.ts";

const config: Config = {
  closePartial: true,
  initialTickSign: 1,
  initialExpectedTicks: 8,
  initialExpectedTickImbalance: 0.5,
  alphaTicks: 0.25,
  alphaTickImbalance: 0.5,
  thresholdFloor: 3,
  thresholdMultiplier: 1,
};
const prices = [100.0, 100.0, 100.1, 100.05, 100.1, 100.15, 100.16, 100.17, 100.18, 100.19, 100.2, 100.21];
const trades: Trade[] = prices.map((price, i) => ({
  tradeId: `T${i + 1}`,
  timestamp: `2026-01-05T14:30:${String(i).padStart(2, "0")}.000Z`,
  session: "2026-01-05",
  symbol: "SYNTH",
  price,
  volume: 10,
  currency: "USD",
}));

// 1) Batch: each bar closes when |imbalance| reaches its (adaptive) threshold.
for (const bar of constructBars(trades, config)) {
  console.log(`bar ${bar.barIndex}: ticks=${bar.tickCount} imbalance=${bar.imbalance} threshold=${bar.threshold} (${bar.closeReason})`);
}

// 2) Streaming: watch the threshold adapt as completed bars update expectations.
console.log("--- streaming (adaptive state) ---");
const builder = new StreamingTickImbalanceBarBuilder(config);
console.log(`seed: E[ticks]=${builder.expectedTicks} E[imb]=${builder.expectedTickImbalance} threshold=${builder.threshold}`);
for (const trade of trades) {
  for (const bar of builder.push(trade)) {
    console.log(`  closed on ${trade.tradeId}: imbalance=${bar.imbalance} >= ${bar.threshold} -> new E[ticks]=${builder.expectedTicks.toFixed(4)} threshold=${builder.threshold.toFixed(4)}`);
  }
}
for (const bar of builder.flush()) {
  console.log(`  flushed partial: ticks=${bar.tickCount} (${bar.closeReason})`);
}
