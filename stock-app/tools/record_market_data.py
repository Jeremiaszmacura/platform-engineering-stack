"""Record a real market data provider response for offline replay.

The end-to-end suite has to exercise stock-app's happy path in CI, where Yahoo
Finance rate-limits the runner's IP. This script calls the real provider once
and writes what it returned to ``fixtures/market-data.json``, which
:class:`FixtureMarketDataProvider` replays when the service runs with
``STOCK_PROVIDER=fixture``.

It records what the *port* returns - validated domain objects - rather than
Yahoo's raw payload. Parsing a DataFrame is already covered by
``tests/test_yahoo_provider.py``; what the recording is for is giving the
cluster real bars to serve without a network call.

Run it from the service directory with ``tox -e record``. Re-record when the
recorded window has aged out of the range the e2e suite asks for - the summary
printed at the end says which window is now on file.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.adapters.providers.yahoo import YahooMarketDataProvider
from src.domain.models import utc_today

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DESTINATION = SERVICE_ROOT / "fixtures" / "market-data.json"

SYMBOLS = ("AAPL",)

# Recorded window: long enough that the e2e suite's range keeps overlapping it
# for about a year, and ending a week back so no session is still moving.
RECORDED_DAYS = 400
SETTLED_LAG_DAYS = 7


def record_symbol(provider, symbol, start, end):
    """Fetch one symbol's metadata and bars from the live provider.

    Args:
        provider: Live provider to call.
        symbol: Ticker symbol to record.
        start: First session date to fetch.
        end: Last session date to fetch.

    Returns:
        The instrument and its bars, as JSON-ready mappings.
    """
    instrument = provider.fetch_instrument(symbol)
    bars = provider.fetch_daily_bars(symbol, start, end)
    return {
        "instrument": instrument.model_dump(mode="json"),
        "bars": [bar.model_dump(mode="json") for bar in bars],
    }


def record(symbols, days, destination):
    """Record the live provider's answer for every symbol and write it out.

    Args:
        symbols: Ticker symbols to record.
        days: Length of the recorded window, in days.
        destination: File to write the recording to.

    Returns:
        The recording that was written.
    """
    provider = YahooMarketDataProvider()
    end = utc_today() - timedelta(days=SETTLED_LAG_DAYS)
    start = end - timedelta(days=days)

    recording = {
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "recordedFrom": provider.name,
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "symbols": {symbol: record_symbol(provider, symbol, start, end) for symbol in symbols},
    }

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(recording, indent=2) + "\n", encoding="utf-8")
    return recording


def describe(recording, destination):
    """Print what was recorded, so the result can be eyeballed before committing.

    Args:
        recording: The recording that was written.
        destination: File it was written to.
    """
    window = recording["window"]
    print(f"recorded from {recording['recordedFrom']} over {window['start']}..{window['end']}")
    for symbol, entry in recording["symbols"].items():
        bars = entry["bars"]
        instrument = entry["instrument"]
        print(f"  {symbol}: {len(bars)} bars, {instrument['name']} on {instrument['exchange']}")
        if bars:
            print(f"    first {bars[0]['session_date']} close {bars[0]['close']}")
            print(f"    last  {bars[-1]['session_date']} close {bars[-1]['close']}")
    print(f"written to {destination.relative_to(SERVICE_ROOT)} ({destination.stat().st_size} bytes)")


if __name__ == "__main__":
    describe(record(SYMBOLS, RECORDED_DAYS, DESTINATION), DESTINATION)
