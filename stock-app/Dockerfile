FROM python:3.14-slim@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# src/ is kept as a package (imported as src.main).
COPY alembic.ini .
COPY migrations/ ./migrations/
COPY src/ ./src/
# The contract is served as-is at /openapi.yaml, so it ships with the image.
COPY openapi.yaml .

# Non-root; HOME is an emptyDir in the pod (yfinance cache, read-only root filesystem).
RUN useradd --create-home --uid 10001 stockapp
USER stockapp

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
