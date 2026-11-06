"""Request parameters, plus the start/end rules OpenAPI can't express (answered with 422)."""

from datetime import date
from typing import Annotated

from fastapi import Depends, HTTPException, Path, Query

from src.domain.models import DateRange, utc_today

# Caps how much one unauthenticated request can fetch; also stated in openapi.yaml.
MAX_RANGE_DAYS = 3650

# Same pattern as the contract's Symbol parameter.
SYMBOL_PATTERN = r"^[A-Za-z0-9.\-]{1,16}$"

# Same as the contract's SecretKey parameter; the key becomes part of a Vault path.
SECRET_KEY_PATTERN = r"^[A-Za-z0-9._\-]{1,64}$"  # nosec B105 - validation regex for key names, not a secret

SymbolPath = Annotated[str, Path(pattern=SYMBOL_PATTERN)]
SecretKeyPath = Annotated[str, Path(pattern=SECRET_KEY_PATTERN)]


def session_date_range(start: Annotated[date, Query()], end: Annotated[date, Query()]) -> DateRange:
    """Return start..end as a DateRange; 422 if inverted, in the future or longer than MAX_RANGE_DAYS."""
    if start > end:
        raise HTTPException(status_code=422, detail="start must not be after end")
    if end > utc_today():
        raise HTTPException(status_code=422, detail="end must not be in the future")
    if (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"range must not span more than {MAX_RANGE_DAYS} days")
    return DateRange(start=start, end=end)


Period = Annotated[DateRange, Depends(session_date_range)]
