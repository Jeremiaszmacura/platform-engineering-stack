# Built from the repo root so the site can include stock-app/openapi.yaml:
#   docker build -t documentation:dev -f documentation/Dockerfile .

# Build the static site once...
FROM python:3.14-slim AS builder

WORKDIR /app

COPY documentation/requirements.txt ./documentation/
RUN pip install --no-cache-dir -r documentation/requirements.txt

COPY documentation/mkdocs.yml ./documentation/
COPY documentation/docs ./documentation/docs
COPY documentation/hooks ./documentation/hooks
COPY stock-app/openapi.yaml ./stock-app/openapi.yaml

WORKDIR /app/documentation
RUN mkdocs build --strict

# ...and serve it with non-root nginx on port 8080
FROM nginxinc/nginx-unprivileged:1.30-alpine

COPY --from=builder /app/documentation/site /usr/share/nginx/html

EXPOSE 8080
