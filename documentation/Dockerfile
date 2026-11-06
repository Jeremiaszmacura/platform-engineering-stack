# Build the static site once...
FROM python:3.14-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY mkdocs.yml .
COPY docs ./docs
RUN mkdocs build --strict

# ...and serve it with non-root nginx on port 8080
FROM nginxinc/nginx-unprivileged:1.30-alpine

COPY --from=builder /app/site /usr/share/nginx/html

EXPOSE 8080
