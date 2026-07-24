/**
 * Stateful, streaming Tick-Imbalance-Bar builder.
 *
 * `./bars`'s `constructBars` aggregates a whole tape at once. A live tape needs a
 * builder that accepts one trade at a time and emits a bar the instant
 * `abs(imbalance) >= threshold`.
 *
 * Because this bar type is *adaptive*, the builder also **exposes its learned
 * state** while it runs: `expectedTicks`, `expectedTickImbalance`, `threshold`,
 * `imbalance`, `tickSign`. Watching those evolve is how you distinguish a
 * mis-seeded threshold from a genuinely quiet tape.
 */

import {
  REQUIRED_TRADE_FIELDS,
  TickImbalanceBarsValidationError,
  finite,
  rounded,
  timestampMs,
  validateConfig,
  type Bar,
  type CloseReason,
  type Config,
  type Trade,
} from "./bars.ts";

export class StreamingTickImbalanceBarBuilder {
  private readonly config: Config;

  // validation state
  private ids = new Set<string>();
  private closedSessions = new Set<string>();
  private validationSession: string | null = null;
  private priorTime: number | null = null;
  private priorSequence: number | null = null;
  private symbol: string | null = null;
  private currency: string | null = null;

  // adaptive + aggregation state
  private current: Trade[] = [];
  private activeSession: string | null = null;
  private previousPrice: number | null = null;
  private _tickSign: number;
  private _expectedTicks: number;
  private _expectedImbalance: number;
  private _imbalance = 0;
  private _threshold = 0;
  private barCount = 0;
  private flushed = false;

  constructor(config: Config) {
    validateConfig(config);
    this.config = config;
    this._tickSign = config.initialTickSign;
    this._expectedTicks = config.initialExpectedTicks;
    this._expectedImbalance = config.initialExpectedTickImbalance;
    this.beginBar();
  }

  /** Current EWMA estimate of ticks per bar (drives the threshold). */
  get expectedTicks(): number {
    return this._expectedTicks;
  }

  /** Current EWMA estimate of imbalance per tick, in [-1, 1]. */
  get expectedTickImbalance(): number {
    return this._expectedImbalance;
  }

  /** Threshold the open bar must reach in `abs(imbalance)` to close. */
  get threshold(): number {
    return this._threshold;
  }

  /** Signed tick imbalance accumulated in the open bar. */
  get imbalance(): number {
    return this._imbalance;
  }

  /** Sign the next flat trade would carry (+1 or -1). */
  get tickSign(): number {
    return this._tickSign;
  }

  /** Trades currently held in the open bar. */
  get tickCount(): number {
    return this.current.length;
  }

  private beginBar(): void {
    this.current = [];
    this._imbalance = 0;
    this._threshold = Math.max(
      this.config.thresholdFloor,
      this.config.thresholdMultiplier * this._expectedTicks * Math.abs(this._expectedImbalance),
    );
  }

  private resetSessionState(): void {
    this.previousPrice = null;
    this._tickSign = this.config.initialTickSign;
    this._expectedTicks = this.config.initialExpectedTicks;
    this._expectedImbalance = this.config.initialExpectedTickImbalance;
  }

  private validateTrade(raw: unknown): Trade {
    if (!raw || typeof raw !== "object") throw new TickImbalanceBarsValidationError("each trade must be an object");
    const trade = raw as Trade;
    const missing = REQUIRED_TRADE_FIELDS.filter((field) => !(field in trade));
    if (missing.length) throw new TickImbalanceBarsValidationError(`trade is missing: ${missing.join(", ")}`);
    for (const name of ["tradeId", "session", "symbol", "currency"] as const) {
      if (typeof trade[name] !== "string" || !trade[name].trim()) {
        throw new TickImbalanceBarsValidationError(`${name} must be a non-empty string`);
      }
    }
    if (this.ids.has(trade.tradeId)) throw new TickImbalanceBarsValidationError("tradeId must be unique");
    this.ids.add(trade.tradeId);

    const currentTime = timestampMs(trade.timestamp);
    if (this.priorTime !== null && currentTime < this.priorTime) {
      throw new TickImbalanceBarsValidationError("trades must be chronological");
    }
    if (this.priorTime !== null && currentTime === this.priorTime) {
      if (!Number.isInteger(trade.sequence) || this.priorSequence === null || trade.sequence! <= this.priorSequence) {
        throw new TickImbalanceBarsValidationError("equal timestamps require strictly increasing integer sequence values");
      }
    }
    this.priorTime = currentTime;
    this.priorSequence = Number.isInteger(trade.sequence) ? trade.sequence! : null;

    if (finite(trade.price, "price") <= 0 || finite(trade.volume, "volume") <= 0) {
      throw new TickImbalanceBarsValidationError("price and volume must be positive");
    }

    if (this.symbol === null) {
      this.symbol = trade.symbol;
      this.currency = trade.currency;
    } else if (trade.symbol !== this.symbol || trade.currency !== this.currency) {
      throw new TickImbalanceBarsValidationError("one symbol and one currency are allowed per call");
    }

    if (this.validationSession === null) this.validationSession = trade.session;
    else if (trade.session !== this.validationSession) {
      this.closedSessions.add(this.validationSession);
      if (this.closedSessions.has(trade.session)) {
        throw new TickImbalanceBarsValidationError("a session may not reappear after another session begins");
      }
      this.validationSession = trade.session;
    }
    return trade;
  }

  private emit(reason: CloseReason): Bar | null {
    if (!this.current.length) return null;
    const prices = this.current.map((trade) => trade.price);
    const volumes = this.current.map((trade) => trade.volume);
    const bar: Bar = {
      barIndex: this.barCount,
      session: this.current[0].session,
      startTime: this.current[0].timestamp,
      endTime: this.current.at(-1)!.timestamp,
      lastTradeTime: this.current.at(-1)!.timestamp,
      open: rounded(prices[0]),
      high: rounded(Math.max(...prices)),
      low: rounded(Math.min(...prices)),
      close: rounded(prices.at(-1)!),
      volume: rounded(volumes.reduce((sum, value) => sum + value, 0)),
      dollarValue: rounded(this.current.reduce((sum, trade) => sum + trade.price * trade.volume, 0)),
      tickCount: this.current.length,
      firstTradeId: this.current[0].tradeId,
      lastTradeId: this.current.at(-1)!.tradeId,
      closeReason: reason,
      imbalance: rounded(this._imbalance),
      threshold: rounded(this._threshold),
    };
    this.barCount += 1;
    if (reason === "threshold") {
      const observedTicks = this.current.length;
      const observedImbalance = this._imbalance / observedTicks;
      this._expectedTicks =
        (1 - this.config.alphaTicks) * this._expectedTicks + this.config.alphaTicks * observedTicks;
      this._expectedImbalance =
        (1 - this.config.alphaTickImbalance) * this._expectedImbalance +
        this.config.alphaTickImbalance * observedImbalance;
    }
    this.beginBar();
    return bar;
  }

  /** Accept one trade and return any bars it closes (zero or one). */
  push(rawTrade: Trade): Bar[] {
    if (this.flushed) throw new TickImbalanceBarsValidationError("cannot push after flush()");
    const trade = this.validateTrade(rawTrade);
    const emitted: Bar[] = [];

    if (this.activeSession !== null && trade.session !== this.activeSession) {
      if (this.current.length && this.config.closePartial) {
        const bar = this.emit("session_end");
        if (bar) emitted.push(bar);
      } else {
        this.beginBar();
      }
      this.resetSessionState();
      this.beginBar();
    }
    this.activeSession = trade.session;

    if (this.previousPrice !== null) {
      if (trade.price > this.previousPrice) this._tickSign = 1;
      else if (trade.price < this.previousPrice) this._tickSign = -1;
    }
    this.previousPrice = trade.price;
    this.current.push(trade);
    this._imbalance += this._tickSign;

    if (Math.abs(this._imbalance) >= this._threshold) {
      const bar = this.emit("threshold");
      if (bar) emitted.push(bar);
    }
    return emitted;
  }

  /** Feed an array of trades, returning every bar closed along the way. */
  pushMany(trades: readonly Trade[]): Bar[] {
    const emitted: Bar[] = [];
    for (const trade of trades) emitted.push(...this.push(trade));
    return emitted;
  }

  /** Close the final partial bar (if `closePartial`) and end the stream. */
  flush(): Bar[] {
    this.flushed = true;
    if (this.current.length && this.config.closePartial) {
      const bar = this.emit("stream_end");
      return bar ? [bar] : [];
    }
    return [];
  }
}
