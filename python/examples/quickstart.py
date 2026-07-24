"""Quickstart: Tick-Imbalance Bars, batch and streaming (with adaptive state).

Run:  python examples/quickstart.py
"""

from fintech_tick_imbalance_bars import StreamingTickImbalanceBarBuilder, construct_bars

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
prices = [100.0, 100.0, 100.1, 100.05, 100.1, 100.15, 100.16, 100.17, 100.18, 100.19, 100.2, 100.21]
trades = [
    {"tradeId": f"T{i+1}", "timestamp": f"2026-01-05T14:{30 + i // 60:02d}:{i % 60:02d}.000Z",
     "session": "2026-01-05", "symbol": "SYNTH", "price": p, "volume": 10, "currency": "USD"}
    for i, p in enumerate(prices)
]

# 1) Batch: each bar closes when |imbalance| reaches its (adaptive) threshold.
for bar in construct_bars(trades, config):
    print(f"bar {bar['barIndex']}: ticks={bar['tickCount']} imbalance={bar['imbalance']} "
          f"threshold={bar['threshold']} ({bar['closeReason']})")

# 2) Streaming: watch the threshold adapt as completed bars update expectations.
print("--- streaming (adaptive state) ---")
builder = StreamingTickImbalanceBarBuilder(config)
print(f"seed: E[ticks]={builder.expected_ticks} E[imb]={builder.expected_tick_imbalance} "
      f"threshold={builder.threshold}")
for trade in trades:
    for bar in builder.push(trade):
        print(f"  closed on {trade['tradeId']}: imbalance={bar['imbalance']} >= {bar['threshold']}"
              f" -> new E[ticks]={builder.expected_ticks:.4f} threshold={builder.threshold:.4f}")
for bar in builder.flush():
    print(f"  flushed partial: ticks={bar['tickCount']} ({bar['closeReason']})")
