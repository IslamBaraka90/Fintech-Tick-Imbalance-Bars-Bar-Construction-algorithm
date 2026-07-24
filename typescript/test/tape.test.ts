import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { constructBars, type Config } from "../src/bars.ts";
import { loadTrades } from "../src/tape.ts";

const CONFIG: Config = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/worked_example.json", import.meta.url)), "utf8"),
).config;
const TAPE_PATH = fileURLToPath(new URL("./fixtures/trade_tape.csv", import.meta.url));

test("loadTrades parses the tape", () => {
  const trades = loadTrades(TAPE_PATH);
  assert.equal(trades.length, 12);
  assert.equal(trades[0].tradeId, "W1");
  assert.equal(trades[0].price, 100);
});

test("constructBars over the loaded tape", () => {
  const bars = constructBars(loadTrades(TAPE_PATH), CONFIG);
  assert.deepEqual(bars.map((b) => b.tickCount), [6, 5, 1]);
  assert.deepEqual(bars.map((b) => b.threshold), [4, 4.375, 5.44270833]);
});
