# Stage 1: bring in the prebuilt SimulationCraft CLI
FROM simulationcraftorg/simc:latest AS simc

# Stage 2: runtime (Python on Alpine + SimC)
FROM python:3.11-alpine AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# OS deps (Alpine/musl) + init
RUN apk add --no-cache \
      bash jq tini ca-certificates \
      libstdc++ curl zlib nghttp2-libs krb5-libs libssh2

# Copy SimC from the simc image (confirmed path)
COPY --from=simc /app/SimulationCraft/simc /usr/local/bin/simc
RUN chmod +x /usr/local/bin/simc \
 && /usr/local/bin/simc 2>&1 | head -n 1 || true   # prints banner; ignore non-zero exit

# Python deps
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip && pip install --no-cache-dir -r /app/backend/requirements.txt

# App source
COPY . /app

EXPOSE 8000
ENTRYPOINT ["/sbin/tini","--"]
