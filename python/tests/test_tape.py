"""Trade-tape loader tests (imbalance bars need per-trade prices to sign ticks)."""

import json
from pathlib import Path

from fintech_tick_imbalance_bars import construct_bars, load_trades

FIXTURES = Path(__file__).parent / "fixtures"
CONFIG = json.loads((FIXTURES / "worked_example.json").read_text())["config"]


def test_load_trades_parses_tape():
    trades = load_trades(FIXTURES / "trade_tape.csv")
    assert len(trades) == 12
    assert trades[0]["tradeId"] == "W1"
    assert trades[0]["price"] == 100.0 and isinstance(trades[0]["price"], float)


def test_construct_bars_over_loaded_tape():
    bars = construct_bars(load_trades(FIXTURES / "trade_tape.csv"), CONFIG)
    assert [b["tickCount"] for b in bars] == [6, 5, 1]
    assert [b["threshold"] for b in bars] == [4.0, 4.375, 5.44270833]
