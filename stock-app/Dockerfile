FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The service is a package tree, so `src/` is copied as a directory (not
# flattened) and imported as `src.main`.
COPY alembic.ini .
COPY migrations/ ./migrations/
COPY src/ ./src/
# The contract is served as-is at /openapi.json, so it ships with the image.
COPY openapi.yaml .
# Recorded provider response replayed when STOCK_PROVIDER=fixture.
COPY fixtures/ ./fixtures/

# Non-root runtime; HOME is writable at runtime through an emptyDir so the
# yfinance timezone cache works with a read-only root filesystem.
RUN useradd --create-home --uid 10001 stockapp
USER stockapp

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
