import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { TickImbalanceBarsValidationError, constructBars, type Config, type Trade } from "../src/bars.ts";
import { StreamingTickImbalanceBarBuilder } from "../src/streaming.ts";
import { loadTrades } from "../src/tape.ts";

const CONFIG: Config = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/worked_example.json", import.meta.url)), "utf8"),
).config;
const TAPE: Trade[] = loadTrades(fileURLToPath(new URL("./fixtures/trade_tape.csv", import.meta.url)));

function stream(trades: Trade[], config: Config) {
  const builder = new StreamingTickImbalanceBarBuilder(config);
  const emitted = builder.pushMany(trades);
  emitted.push(...builder.flush());
  return emitted;
}

test("streaming matches batch", () => {
  assert.deepEqual(stream(TAPE, CONFIG), constructBars(TAPE, CONFIG));
});

test("streaming matches batch (closePartial=false)", () => {
  const config = { ...CONFIG, closePartial: false };
  assert.deepEqual(stream(TAPE, config), constructBars(TAPE, config));
});

test("adaptive state is observable and seeded", () => {
  const builder = new StreamingTickImbalanceBarBuilder(CONFIG);
  assert.equal(builder.expectedTicks, 8);
  assert.equal(builder.expectedTickImbalance, 0.5);
  assert.equal(builder.threshold, 4);
  assert.equal(builder.imbalance, 0);
  assert.equal(builder.tickCount, 0);
});

test("state updates after a threshold close", () => {
  const builder = new StreamingTickImbalanceBarBuilder(CONFIG);
  const closed = builder.pushMany(TAPE.slice(0, 6));
  assert.equal(closed.length, 1);
  assert.equal(closed[0].closeReason, "threshold");
  assert.equal(builder.expectedTicks, 7.5);
  assert.ok(Math.abs(builder.expectedTickImbalance - 0.5833333333333333) < 1e-12);
  assert.ok(Math.abs(builder.threshold - 4.375) < 1e-12);
});

test("imbalance accumulates before the close", () => {
  const builder = new StreamingTickImbalanceBarBuilder(CONFIG);
  builder.push(TAPE[0]);
  assert.equal(builder.imbalance, 1);
  assert.equal(builder.tickCount, 1);
  builder.push(TAPE[1]); // flat -> carries +1
  assert.equal(builder.imbalance, 2);
  builder.push(TAPE[2]); // uptick
  builder.push(TAPE[3]); // downtick
  assert.equal(builder.imbalance, 2);
  assert.equal(builder.tickSign, -1);
});

test("push emits exactly when the threshold is reached", () => {
  const builder = new StreamingTickImbalanceBarBuilder(CONFIG);
  for (const trade of TAPE.slice(0, 5)) assert.deepEqual(builder.push(trade), []);
  const closed = builder.push(TAPE[5]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].tickCount, 6);
});

test("flush closes the partial tail", () => {
  const builder = new StreamingTickImbalanceBarBuilder(CONFIG);
  builder.pushMany(TAPE);
  const final = builder.flush();
  assert.equal(final.length, 1);
  assert.equal(final[0].closeReason, "stream_end");
});

test("cannot push after flush", () => {
  const builder = new StreamingTickImbalanceBarBuilder(CONFIG);
  builder.pushMany(TAPE);
  builder.flush();
  assert.throws(() => builder.push(TAPE[0]), TickImbalanceBarsValidationError);
});
