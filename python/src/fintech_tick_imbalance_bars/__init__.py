"""Fintech Tick-Imbalance Bars — information-driven bar construction.

A small, well-specified, cross-language reference implementation of Tick-Imbalance
Bars: a bar closes when the signed order-flow imbalance inside it exceeds a
threshold that adapts, via EWMA, to recent bar length and imbalance.

Companion article (canonical): https://thefintechbuilder.com/market-data-engineering/bar-construction/tick-imbalance-bars/
Catalog topic id: D01-F01-A05  (Domain D01 — Market Data Engineering / Family D01-F01 — Bar Construction)
"""

from __future__ import annotations

from .core import TickImbalanceBarsValidationError, construct_bars
from .streaming import StreamingTickImbalanceBarBuilder
from .tape import load_trades

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "TickImbalanceBarsValidationError",
    "construct_bars",
    "StreamingTickImbalanceBarBuilder",
    "load_trades",
]
