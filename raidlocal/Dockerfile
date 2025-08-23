# Stage 1: use official prebuilt SimulationCraft CLI
FROM simulationcraftorg/simc:1110-2025-04-07-7c28377 AS simc

# Stage 2: runtime (Python + simc)
FROM python:3.11-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# Copy simc binary from builder image
COPY --from=simc /usr/local/bin/simc /usr/local/bin/simc

# Minimal tools + init
RUN apt-get update && apt-get install -y --no-install-recommends bash jq tini && rm -rf /var/lib/apt/lists/*

# Python deps
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/backend/requirements.txt

# App source
COPY . /app

EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini","--"]
