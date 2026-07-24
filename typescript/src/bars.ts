/**
 * Causal Tick-Imbalance Bars under a disclosed EMA convention.
 *
 * A faithful, cross-language twin of the Python
 * `fintech_tick_imbalance_bars.core` module and of the reference algorithm
 * published at The Fintech Builder (topic `D01-F01-A05`).
 *
 * The tick rule signs each trade: uptick `+1`, downtick `-1`, flat carries the
 * **preceding** sign (the first trade of a session uses `initialTickSign`). A bar
 * accumulates `imbalance = sum of signs` and closes when
 * `abs(imbalance) >= threshold`, where after every *threshold*-closed bar:
 *
 *     threshold = max(thresholdFloor, thresholdMultiplier * E[ticks] * abs(E[tickImbalance]))
 *     E[ticks]         <- (1-alphaTicks)*E[ticks] + alphaTicks*observedTicks
 *     E[tickImbalance] <- (1-alphaTickImbalance)*E[tickImbalance] + alphaTickImbalance*(imbalance/observedTicks)
 *
 * Partial bars (session end, stream end) never move the expectations.
 */

export class TickImbalanceBarsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TickImbalanceBarsValidationError";
  }
}

export interface Trade {
  tradeId: string;
  timestamp: string;
  session: string;
  symbol: string;
  price: number;
  volume: number;
  currency: string;
  sequence?: number;
}

export interface Config {
  closePartial: boolean;
  initialTickSign: -1 | 1;
  initialExpectedTicks: number;
  initialExpectedTickImbalance: number;
  alphaTicks: number;
  alphaTickImbalance: number;
  thresholdFloor: number;
  thresholdMultiplier: number;
}

export type CloseReason = "threshold" | "session_end" | "stream_end";

export interface Bar {
  barIndex: number;
  session: string;
  startTime: string;
  endTime: string;
  lastTradeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dollarValue: number;
  tickCount: number;
  firstTradeId: string;
  lastTradeId: string;
  closeReason: CloseReason;
  imbalance: number;
  threshold: number;
}

export const REQUIRED_TRADE_FIELDS = [
  "tradeId", "timestamp", "session", "symbol", "price", "volume", "currency",
] as const;

export function timestampMs(value: unknown): number {
  if (typeof value !== "string" || !value.endsWith("Z")) {
    throw new TickImbalanceBarsValidationError("timestamp must be an ISO-8601 UTC string ending in Z");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TickImbalanceBarsValidationError("timestamp must be valid ISO-8601");
  return parsed;
}

export function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TickImbalanceBarsValidationError(`${name} must be a finite number`);
  }
  return value;
}

function positive(value: unknown, name: string): number {
  const parsed = finite(value, name);
  if (parsed <= 0) throw new TickImbalanceBarsValidationError(`${name} must be positive`);
  return parsed;
}

export function rounded(value: number): number {
  return Number(value.toFixed(8));
}

export function validateConfig(config: Config): void {
  if (!config || typeof config !== "object") throw new TickImbalanceBarsValidationError("config must be an object");
  const required = [
    "closePartial", "initialTickSign", "initialExpectedTicks", "initialExpectedTickImbalance",
    "alphaTicks", "alphaTickImbalance", "thresholdFloor", "thresholdMultiplier",
  ] as const;
  const missing = required.filter((key) => !(key in config));
  if (missing.length) throw new TickImbalanceBarsValidationError(`config is missing: ${missing.join(", ")}`);
  if (typeof config.closePartial !== "boolean") throw new TickImbalanceBarsValidationError("closePartial must be boolean");
  if (config.initialTickSign !== -1 && config.initialTickSign !== 1) {
    throw new TickImbalanceBarsValidationError("initialTickSign must be -1 or +1");
  }
  positive(config.initialExpectedTicks, "initialExpectedTicks");
  const seed = finite(config.initialExpectedTickImbalance, "initialExpectedTickImbalance");
  if (seed < -1 || seed > 1) throw new TickImbalanceBarsValidationError("initialExpectedTickImbalance must be in [-1, 1]");
  for (const [name, value] of [
    ["alphaTicks", config.alphaTicks],
    ["alphaTickImbalance", config.alphaTickImbalance],
  ] as const) {
    const alpha = finite(value, name);
    if (alpha <= 0 || alpha > 1) throw new TickImbalanceBarsValidationError(`${name} must be in (0, 1]`);
  }
  positive(config.thresholdFloor, "thresholdFloor");
  positive(config.thresholdMultiplier, "thresholdMultiplier");
}

function validateTrades(trades: Trade[]): void {
  if (!Array.isArray(trades)) throw new TickImbalanceBarsValidationError("trades must be an array");
  const ids = new Set<string>();
  const closedSessions = new Set<string>();
  let activeSession: string | null = null;
  let priorTime: number | null = null;
  let priorSequence: number | null = null;
  let symbol: string | null = null;
  let currency: string | null = null;

  for (const trade of trades) {
    if (!trade || typeof trade !== "object") throw new TickImbalanceBarsValidationError("each trade must be an object");
    const missing = REQUIRED_TRADE_FIELDS.filter((field) => !(field in trade));
    if (missing.length) throw new TickImbalanceBarsValidationError(`trade is missing: ${missing.join(", ")}`);
    for (const name of ["tradeId", "session", "symbol", "currency"] as const) {
      if (typeof trade[name] !== "string" || !trade[name].trim()) {
        throw new TickImbalanceBarsValidationError(`${name} must be a non-empty string`);
      }
    }
    if (ids.has(trade.tradeId)) throw new TickImbalanceBarsValidationError("tradeId must be unique");
    ids.add(trade.tradeId);

    const currentTime = timestampMs(trade.timestamp);
    if (priorTime !== null && currentTime < priorTime) throw new TickImbalanceBarsValidationError("trades must be chronological");
    if (priorTime !== null && currentTime === priorTime) {
      if (!Number.isInteger(trade.sequence) || priorSequence === null || trade.sequence! <= priorSequence) {
        throw new TickImbalanceBarsValidationError("equal timestamps require strictly increasing integer sequence values");
      }
    }
    priorTime = currentTime;
    priorSequence = Number.isInteger(trade.sequence) ? trade.sequence! : null;

    if (positive(trade.price, "price") <= 0 || positive(trade.volume, "volume") <= 0) {
      throw new TickImbalanceBarsValidationError("price and volume must be positive");
    }

    if (symbol === null) {
      symbol = trade.symbol;
      currency = trade.currency;
    } else if (trade.symbol !== symbol || trade.currency !== currency) {
      throw new TickImbalanceBarsValidationError("one symbol and one currency are allowed per call");
    }

    if (activeSession === null) activeSession = trade.session;
    else if (trade.session !== activeSession) {
      closedSessions.add(activeSession);
      if (closedSessions.has(trade.session)) {
        throw new TickImbalanceBarsValidationError("a session may not reappear after another session begins");
      }
      activeSession = trade.session;
    }
  }
}

export function constructBars(trades: Trade[], config: Config): Bar[] {
  validateConfig(config);
  validateTrades(trades);
  if (trades.length === 0) return [];

  const result: Bar[] = [];
  let current: Trade[] = [];
  let activeSession: string | null = null;
  let previousPrice: number | null = null;
  let tickSign: number = config.initialTickSign;
  let expectedTicks = config.initialExpectedTicks;
  let expectedImbalance = config.initialExpectedTickImbalance;
  let imbalance = 0;
  let threshold = 0;

  const beginBar = (): void => {
    current = [];
    imbalance = 0;
    threshold = Math.max(
      config.thresholdFloor,
      config.thresholdMultiplier * expectedTicks * Math.abs(expectedImbalance),
    );
  };
  const resetSessionState = (): void => {
    previousPrice = null;
    tickSign = config.initialTickSign;
    expectedTicks = config.initialExpectedTicks;
    expectedImbalance = config.initialExpectedTickImbalance;
  };
  const emit = (reason: CloseReason): void => {
    if (!current.length) return;
    const prices = current.map((trade) => trade.price);
    const volumes = current.map((trade) => trade.volume);
    result.push({
      barIndex: result.length,
      session: current[0].session,
      startTime: current[0].timestamp,
      endTime: current.at(-1)!.timestamp,
      lastTradeTime: current.at(-1)!.timestamp,
      open: rounded(prices[0]),
      high: rounded(Math.max(...prices)),
      low: rounded(Math.min(...prices)),
      close: rounded(prices.at(-1)!),
      volume: rounded(volumes.reduce((sum, value) => sum + value, 0)),
      dollarValue: rounded(current.reduce((sum, trade) => sum + trade.price * trade.volume, 0)),
      tickCount: current.length,
      firstTradeId: current[0].tradeId,
      lastTradeId: current.at(-1)!.tradeId,
      closeReason: reason,
      imbalance: rounded(imbalance),
      threshold: rounded(threshold),
    });
    // Only a complete bar is evidence about the process.
    if (reason === "threshold") {
      const observedTicks = current.length;
      const observedImbalance = imbalance / observedTicks;
      expectedTicks = (1 - config.alphaTicks) * expectedTicks + config.alphaTicks * observedTicks;
      expectedImbalance =
        (1 - config.alphaTickImbalance) * expectedImbalance + config.alphaTickImbalance * observedImbalance;
    }
    beginBar();
  };

  beginBar();
  for (const trade of trades) {
    if (activeSession !== null && trade.session !== activeSession) {
      if (current.length && config.closePartial) emit("session_end");
      else beginBar();
      resetSessionState();
      beginBar();
    }
    activeSession = trade.session;
    if (previousPrice !== null) {
      if (trade.price > previousPrice) tickSign = 1;
      else if (trade.price < previousPrice) tickSign = -1;
      // A flat trade deliberately carries the preceding sign.
    }
    previousPrice = trade.price;
    current.push(trade);
    imbalance += tickSign;
    if (Math.abs(imbalance) >= threshold) emit("threshold");
  }
  if (current.length && config.closePartial) emit("stream_end");
  return result;
}
