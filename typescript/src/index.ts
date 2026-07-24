/**
 * Fintech Tick-Imbalance Bars — information-driven bar construction.
 *
 * Companion article (canonical): https://thefintechbuilder.com/market-data-engineering/bar-construction/tick-imbalance-bars/
 * Catalog topic id: D01-F01-A05 (Domain D01 — Market Data Engineering / Family D01-F01 — Bar Construction)
 */

export {
  TickImbalanceBarsValidationError,
  constructBars,
  type Trade,
  type Config,
  type Bar,
  type CloseReason,
} from "./bars.ts";
export { StreamingTickImbalanceBarBuilder } from "./streaming.ts";
export { loadTrades } from "./tape.ts";
