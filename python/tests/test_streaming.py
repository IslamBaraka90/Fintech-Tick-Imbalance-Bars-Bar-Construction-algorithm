"""StreamingTickImbalanceBarBuilder: batch parity plus observable adaptive state."""

import json
from pathlib import Path

import pytest

from fintech_tick_imbalance_bars import (
    StreamingTickImbalanceBarBuilder,
    TickImbalanceBarsValidationError,
    construct_bars,
    load_trades,
)

FIXTURES = Path(__file__).parent / "fixtures"
CONFIG = json.loads((FIXTURES / "worked_example.json").read_text())["config"]
TAPE = load_trades(FIXTURES / "trade_tape.csv")


def _stream(trades, config):
    builder = StreamingTickImbalanceBarBuilder(config)
    emitted = builder.push_many(trades)
    emitted.extend(builder.flush())
    return emitted


def test_streaming_matches_batch():
    assert _stream(TAPE, CONFIG) == construct_bars(TAPE, CONFIG)


def test_streaming_matches_batch_close_partial_false():
    config = {**CONFIG, "closePartial": False}
    assert _stream(TAPE, config) == construct_bars(TAPE, config)


def test_adaptive_state_is_observable_and_seeded():
    builder = StreamingTickImbalanceBarBuilder(CONFIG)
    assert builder.expected_ticks == 8
    assert builder.expected_tick_imbalance == 0.5
    assert builder.threshold == 4  # max(3, 1*8*0.5)
    assert builder.imbalance == 0 and builder.tick_count == 0


def test_state_updates_after_a_threshold_close():
    builder = StreamingTickImbalanceBarBuilder(CONFIG)
    closed = builder.push_many(TAPE[:6])
    assert len(closed) == 1 and closed[0]["closeReason"] == "threshold"
    # The documented post-close EWMA update.
    assert builder.expected_ticks == 7.5
    assert builder.expected_tick_imbalance == pytest.approx(0.5833333333333333)
    assert builder.threshold == pytest.approx(4.375)


def test_imbalance_accumulates_before_the_close():
    builder = StreamingTickImbalanceBarBuilder(CONFIG)
    builder.push(TAPE[0])
    assert builder.imbalance == 1 and builder.tick_count == 1
    builder.push(TAPE[1])  # flat -> carries +1
    assert builder.imbalance == 2
    builder.push(TAPE[2])  # uptick
    builder.push(TAPE[3])  # downtick -> back to 2
    assert builder.imbalance == 2 and builder.tick_sign == -1


def test_push_emits_exactly_when_threshold_is_reached():
    builder = StreamingTickImbalanceBarBuilder(CONFIG)
    for trade in TAPE[:5]:
        assert builder.push(trade) == []
    closed = builder.push(TAPE[5])  # imbalance 4 >= threshold 4
    assert len(closed) == 1 and closed[0]["tickCount"] == 6


def test_flush_closes_the_partial_tail():
    builder = StreamingTickImbalanceBarBuilder(CONFIG)
    builder.push_many(TAPE)
    final = builder.flush()
    assert len(final) == 1 and final[0]["closeReason"] == "stream_end"


def test_cannot_push_after_flush():
    builder = StreamingTickImbalanceBarBuilder(CONFIG)
    builder.push_many(TAPE)
    builder.flush()
    with pytest.raises(TickImbalanceBarsValidationError):
        builder.push(TAPE[0])


def test_streaming_validates_incrementally():
    builder = StreamingTickImbalanceBarBuilder(CONFIG)
    builder.push(TAPE[0])
    with pytest.raises(TickImbalanceBarsValidationError):
        builder.push({**TAPE[1], "tradeId": "W1"})
