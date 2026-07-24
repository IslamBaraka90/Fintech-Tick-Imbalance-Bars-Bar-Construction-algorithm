import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { TickImbalanceBarsValidationError, constructBars, type Config, type Trade } from "../src/bars.ts";
import { loadTrades } from "../src/tape.ts";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/worked_example.json", import.meta.url)), "utf8"),
);
const CONFIG: Config = FIXTURE.config;
const TAPE: Trade[] = loadTrades(fileURLToPath(new URL("./fixtures/trade_tape.csv", import.meta.url)));
const WORKED = TAPE.slice(0, 6);

test("opening threshold matches the documented value", () => {
  const bar = constructBars(WORKED, CONFIG)[0];
  assert.equal(bar.threshold, FIXTURE.openingThreshold);
  assert.equal(bar.threshold, 4);
});

test("worked example completed bar", () => {
  const bars = constructBars(WORKED, CONFIG);
  assert.equal(bars.length, 1);
  const bar = bars[0];
  assert.equal(bar.tickCount, FIXTURE.completedBar.tickCount);
  assert.equal(bar.imbalance, FIXTURE.completedBar.imbalance);
  assert.equal(bar.threshold, FIXTURE.completedBar.threshold);
  assert.equal(bar.closeReason, "threshold");
  assert.equal(bar.open, 100);
  assert.equal(bar.close, 100.15);
});

test("post-close EWMA update drives the next threshold", () => {
  const bars = constructBars(TAPE, CONFIG);
  assert.equal(bars[1].threshold, FIXTURE.postCloseUpdate.nextThreshold);
  assert.equal(bars[1].threshold, 4.375);
});

test("full tape produces three bars", () => {
  const bars = constructBars(TAPE, CONFIG);
  assert.deepEqual(bars.map((b) => b.tickCount), [6, 5, 1]);
  assert.deepEqual(bars.map((b) => b.imbalance), [4, 5, 1]);
  assert.deepEqual(bars.map((b) => b.threshold), [4, 4.375, 5.44270833]);
  assert.deepEqual(bars.map((b) => b.closeReason), ["threshold", "threshold", "stream_end"]);
});

test("flat trade carries the preceding sign", () => {
  const trades: Trade[] = [
    { tradeId: "A", timestamp: "2026-01-05T00:00:00.000Z", session: "S", symbol: "X", price: 100, volume: 1, currency: "USD" },
    { tradeId: "B", timestamp: "2026-01-05T00:00:01.000Z", session: "S", symbol: "X", price: 99, volume: 1, currency: "USD" },
    { tradeId: "C", timestamp: "2026-01-05T00:00:02.000Z", session: "S", symbol: "X", price: 99, volume: 1, currency: "USD" },
  ];
  const bar = constructBars(trades, { ...CONFIG, thresholdFloor: 100 })[0];
  assert.equal(bar.imbalance, -1);
  assert.equal(bar.closeReason, "stream_end");
});

test("partial bars do not update expectations", () => {
  const bars = constructBars(WORKED.slice(0, 2), CONFIG);
  assert.equal(bars[0].closeReason, "stream_end");
  assert.equal(bars[0].threshold, 4);
});

test("threshold floor applies", () => {
  const bars = constructBars(TAPE, { ...CONFIG, thresholdFloor: 1000 });
  assert.equal(bars.length, 1);
  assert.equal(bars[0].closeReason, "stream_end");
  assert.equal(bars[0].threshold, 1000);
});

test("empty trades returns empty", () => {
  assert.deepEqual(constructBars([], CONFIG), []);
});

test("closePartial=false drops the tail", () => {
  const bars = constructBars(TAPE, { ...CONFIG, closePartial: false });
  assert.deepEqual(bars.map((b) => b.closeReason), ["threshold", "threshold"]);
});

test("rejects bad config", () => {
  const overrides: Array<Partial<Config>> = [
    { initialTickSign: 0 as unknown as 1 },
    { initialExpectedTicks: 0 },
    { initialExpectedTickImbalance: 2 },
    { alphaTicks: 0 },
    { alphaTickImbalance: 1.5 },
    { thresholdFloor: -1 },
    { thresholdMultiplier: 0 },
  ];
  for (const override of overrides) {
    assert.throws(() => constructBars(WORKED, { ...CONFIG, ...override }), TickImbalanceBarsValidationError);
  }
});

test("rejects missing config key", () => {
  const { alphaTicks: _drop, ...partial } = CONFIG;
  assert.throws(() => constructBars(WORKED, partial as Config), TickImbalanceBarsValidationError);
});

test("rejects duplicate trade id", () => {
  assert.throws(
    () => constructBars([WORKED[0], { ...WORKED[1], tradeId: "W1" }], CONFIG),
    TickImbalanceBarsValidationError,
  );
});

test("rejects unordered trades", () => {
  assert.throws(() => constructBars([...WORKED].reverse(), CONFIG), TickImbalanceBarsValidationError);
});
