FROM python:3.9-slim

# This image mirrors the repository layout and is built from the repository
# root, not from documentation/. hooks/contracts.py resolves a service contract
# relative to mkdocs.yml, so stock-app/ has to sit next to documentation/ here
# exactly as it does in a checkout - that is what lets the site render
# stock-app's OpenAPI contract without keeping a second copy of it.
WORKDIR /app

# Copy the requirements file
COPY documentation/requirements.txt ./documentation/

# Install the dependencies
RUN pip install --no-cache-dir -r documentation/requirements.txt

# Copy the documentation files, and the contracts the site renders
COPY documentation/docs ./documentation/docs
COPY documentation/hooks ./documentation/hooks
COPY documentation/mkdocs.yml ./documentation/
COPY stock-app/openapi.yaml ./stock-app/openapi.yaml

WORKDIR /app/documentation

# Expose port
EXPOSE 11000

# Start MkDocs server
CMD ["mkdocs", "serve", "--dev-addr=0.0.0.0:11000"]
