"""Exactness and contract tests for Tick-Imbalance Bars.

The worked-example fixture documents the package arithmetic step by step: the
opening threshold (4), the tick signs, the running imbalance, the completed bar
(6 ticks, imbalance 4), and the post-close EWMA update (expectedTicks 7.5,
expectedTickImbalance 0.5833..., nextThreshold 4.375). Both language suites
assert those values.
"""

import json
from pathlib import Path

import pytest

from fintech_tick_imbalance_bars import TickImbalanceBarsValidationError, construct_bars, load_trades

FIXTURES = Path(__file__).parent / "fixtures"
FIXTURE = json.loads((FIXTURES / "worked_example.json").read_text())
CONFIG = FIXTURE["config"]
TAPE = load_trades(FIXTURES / "trade_tape.csv")
WORKED = TAPE[:6]  # W1..W6 — exactly the worked-example sequence


def test_opening_threshold_matches_documented_value():
    # max(floor=3, multiplier=1 * expectedTicks=8 * |expectedImbalance=0.5|) = 4
    bar = construct_bars(WORKED, CONFIG)[0]
    assert bar["threshold"] == FIXTURE["openingThreshold"] == 4


def test_worked_example_completed_bar():
    bars = construct_bars(WORKED, CONFIG)
    assert len(bars) == 1
    bar = bars[0]
    documented = FIXTURE["completedBar"]
    assert bar["tickCount"] == documented["tickCount"] == 6
    assert bar["imbalance"] == documented["imbalance"] == 4
    assert bar["threshold"] == documented["threshold"] == 4
    assert bar["closeReason"] == "threshold"
    assert bar["open"] == 100.0 and bar["close"] == 100.15


def test_post_close_ewma_update_drives_the_next_threshold():
    # The documented nextThreshold (4.375) must actually be used by the next bar.
    bars = construct_bars(TAPE, CONFIG)
    assert bars[1]["threshold"] == FIXTURE["postCloseUpdate"]["nextThreshold"] == 4.375
    # expectedTicks = 0.75*8 + 0.25*6 = 7.5 ; expectedImb = 0.5*0.5 + 0.5*(4/6) = 0.58333...
    expected = FIXTURE["postCloseUpdate"]
    assert expected["expectedTicks"] * abs(expected["expectedTickImbalance"]) == pytest.approx(4.375)


def test_full_tape_produces_three_bars():
    bars = construct_bars(TAPE, CONFIG)
    assert [b["tickCount"] for b in bars] == [6, 5, 1]
    assert [b["imbalance"] for b in bars] == [4, 5, 1]
    assert [b["threshold"] for b in bars] == [4.0, 4.375, 5.44270833]
    assert [b["closeReason"] for b in bars] == ["threshold", "threshold", "stream_end"]


def test_flat_trade_carries_the_preceding_sign():
    # W1 (no previous price) takes initialTickSign=+1; W2 is flat and carries +1.
    documented_signs = [t["tickSign"] for t in FIXTURE["trades"]]
    assert documented_signs[:2] == [1, 1]
    # A downtick then a flat must carry -1: build a tiny tape to prove it.
    trades = [
        {"tradeId": "A", "timestamp": "2026-01-05T00:00:00.000Z", "session": "S", "symbol": "X", "price": 100.0, "volume": 1, "currency": "USD"},
        {"tradeId": "B", "timestamp": "2026-01-05T00:00:01.000Z", "session": "S", "symbol": "X", "price": 99.0, "volume": 1, "currency": "USD"},
        {"tradeId": "C", "timestamp": "2026-01-05T00:00:02.000Z", "session": "S", "symbol": "X", "price": 99.0, "volume": 1, "currency": "USD"},
    ]
    # signs: +1 (seed), -1 (downtick), -1 (flat carries) -> imbalance = -1
    bar = construct_bars(trades, {**CONFIG, "thresholdFloor": 100})[0]
    assert bar["imbalance"] == -1 and bar["closeReason"] == "stream_end"


def test_partial_bars_do_not_update_expectations():
    # A stream_end bar must leave the threshold unchanged for a fresh run.
    first = construct_bars(WORKED[:2], CONFIG)  # closes only at stream end
    assert first[0]["closeReason"] == "stream_end"
    assert first[0]["threshold"] == 4  # still the opening threshold


def test_threshold_floor_applies():
    # With a huge floor, no bar can close on imbalance; only stream_end remains.
    bars = construct_bars(TAPE, {**CONFIG, "thresholdFloor": 1000})
    assert len(bars) == 1 and bars[0]["closeReason"] == "stream_end"
    assert bars[0]["threshold"] == 1000


def test_empty_trades_returns_empty():
    assert construct_bars([], CONFIG) == []


def test_close_partial_false_drops_the_tail():
    bars = construct_bars(TAPE, {**CONFIG, "closePartial": False})
    assert [b["closeReason"] for b in bars] == ["threshold", "threshold"]


@pytest.mark.parametrize(
    "override",
    [
        {"initialTickSign": 0},
        {"initialExpectedTicks": 0},
        {"initialExpectedTickImbalance": 2},
        {"alphaTicks": 0},
        {"alphaTickImbalance": 1.5},
        {"thresholdFloor": -1},
        {"thresholdMultiplier": 0},
    ],
)
def test_rejects_bad_config(override):
    with pytest.raises(TickImbalanceBarsValidationError):
        construct_bars(WORKED, {**CONFIG, **override})


def test_rejects_missing_config_key():
    partial = {k: v for k, v in CONFIG.items() if k != "alphaTicks"}
    with pytest.raises(TickImbalanceBarsValidationError):
        construct_bars(WORKED, partial)


def test_rejects_duplicate_trade_id():
    with pytest.raises(TickImbalanceBarsValidationError):
        construct_bars([WORKED[0], {**WORKED[1], "tradeId": "W1"}], CONFIG)


def test_rejects_unordered_trades():
    with pytest.raises(TickImbalanceBarsValidationError):
        construct_bars(list(reversed(WORKED)), CONFIG)


def test_rejects_mixed_symbol():
    with pytest.raises(TickImbalanceBarsValidationError):
        construct_bars([WORKED[0], {**WORKED[1], "symbol": "OTHER"}], CONFIG)
