FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# src/ is kept as a package (imported as src.main).
COPY alembic.ini .
COPY migrations/ ./migrations/
COPY src/ ./src/
# The contract is served as-is at /openapi.yaml, so it ships with the image.
COPY openapi.yaml .
# Recorded provider response replayed when STOCK_PROVIDER=fixture.
COPY fixtures/ ./fixtures/

# Non-root; HOME is an emptyDir in the pod (yfinance cache, read-only root filesystem).
RUN useradd --create-home --uid 10001 stockapp
USER stockapp

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
