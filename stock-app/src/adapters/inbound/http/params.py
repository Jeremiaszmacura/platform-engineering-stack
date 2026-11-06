"""Request parameters, including the rules OpenAPI cannot express.

``openapi.yaml`` declares ``symbol``, ``start`` and ``end`` and the framework
enforces their individual schemas. The relations *between* ``start`` and
``end`` are cross-parameter, which JSON Schema has no vocabulary for, so they
are checked here and answer 422 before the use case runs.
"""

from datetime import date
from typing import Annotated

from fastapi import Depends, HTTPException, Path, Query

from src.domain.models import DateRange, utc_today

# The endpoint is unauthenticated and every request can reach the provider, so
# the span one request may ask for is capped. Also stated in the contract's
# `end` parameter description, which test_openapi_contract.py keeps in step.
MAX_RANGE_DAYS = 3650

# Case-insensitive counterpart of the domain's symbol rule, and the same
# pattern as the contract's `Symbol` parameter: the domain uppercases, this
# rejects anything that could not be a symbol at all.
SYMBOL_PATTERN = r"^[A-Za-z0-9.\-]{1,16}$"

# Same alphabet as the contract's `SecretKey` parameter. The key becomes part
# of a Vault path, so nothing outside it may pass.
SECRET_KEY_PATTERN = r"^[A-Za-z0-9._\-]{1,64}$"  # nosec B105 - validation regex for key names, not a secret

SymbolPath = Annotated[str, Path(pattern=SYMBOL_PATTERN)]
SecretKeyPath = Annotated[str, Path(pattern=SECRET_KEY_PATTERN)]


def session_date_range(start: Annotated[date, Query()], end: Annotated[date, Query()]) -> DateRange:
    """Validate an inclusive session-date window and hand it over as a domain range.

    Args:
        start: First session date requested.
        end: Last session date requested.

    Returns:
        The window as a domain range.

    Raises:
        HTTPException: 422 if the window is inverted, future-dated or too long.
    """
    if start > end:
        raise HTTPException(status_code=422, detail="start must not be after end")
    if end > utc_today():
        raise HTTPException(status_code=422, detail="end must not be in the future")
    if (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"range must not span more than {MAX_RANGE_DAYS} days")
    return DateRange(start=start, end=end)


Period = Annotated[DateRange, Depends(session_date_range)]
