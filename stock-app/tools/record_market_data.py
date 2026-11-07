"""Record a live Yahoo response into fixtures/market-data.json for the fixture provider.

Run with `tox -e record` when the recorded window no longer overlaps the e2e range.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.adapters.providers.yahoo import YahooMarketDataProvider
from src.domain.models import utc_today

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DESTINATION = SERVICE_ROOT / "fixtures" / "market-data.json"

SYMBOLS = ("AAPL",)

# Long enough for about a year of e2e runs; ends a week ago so no session is still moving.
RECORDED_DAYS = 400
SETTLED_LAG_DAYS = 7


def record_symbol(provider, symbol, start, end):
    """Return one symbol's instrument and bars from the live provider, as JSON-ready dicts."""
    instrument = provider.fetch_instrument(symbol)
    bars = provider.fetch_daily_bars(symbol, start, end)
    return {
        "instrument": instrument.model_dump(mode="json"),
        "bars": [bar.model_dump(mode="json") for bar in bars],
    }


def record(symbols, days, destination):
    """Record every symbol over the last `days` days, write it to destination and return it."""
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
    """Print a summary of the recording."""
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
