# ========================
# == CLIENT BUILD STAGE ==
# ========================
FROM node:24.15.0 AS client-builder
WORKDIR /app

# Install dependencies
COPY client/package.json client/package-lock.json /app/
RUN npm install
# Build
COPY .git/ /app/.git/
COPY client/ /app/
RUN npm run build:web

FROM node:24.15.0 AS girder-client-builder
WORKDIR /app
RUN apt-get update && apt-get install -y git
# make sure I clone 
ARG CACHEBUST=2
RUN git clone https://github.com/girder/girder.git
RUN cd girder/girder && cd web && npm install --include=optional && npx vite build --base=/girder/



# ========================
# == SERVER BUILD STAGE ==
# ========================
# Note: server-builder stage will be the same in both dockerfiles
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS server-builder
SHELL ["/bin/bash", "-c"]

WORKDIR /opt/dive/src
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# https://cryptography.io/en/latest/installation/#debian-ubuntu
RUN apt-get update
RUN apt-get install -y build-essential libssl-dev libffi-dev python3-libtiff libgdal-dev python3-dev cargo nodejs npm
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
ENV VIRTUAL_ENV="/opt/dive/local/venv"
ENV UV_PROJECT_ENVIRONMENT=/opt/dive/local/venv
ENV PATH="/opt/dive/local/venv/bin:$PATH"
RUN uv venv /opt/dive/local/venv

# Copy only the lock and project files to optimize cache
COPY server/pyproject.toml server/uv.lock /opt/dive/src/
RUN uv sync --frozen --no-install-project --no-dev --extra large-image
# Copy full source code and install
COPY server/ /opt/dive/src/
RUN uv sync --frozen --no-dev --extra large-image

# =================
# == DIST SERVER ==
# =================
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS server

# Hack: Tell GitPython to be quiet, we aren't using git
ENV GIT_PYTHON_REFRESH="quiet"
ENV VIRTUAL_ENV="/opt/dive/local/venv"
ENV UV_PROJECT_ENVIRONMENT=/opt/dive/local/venv
ENV PATH="/opt/dive/local/venv/bin:/usr/local/bin:$PATH"

# Copy site packages and executables
COPY --from=server-builder /opt/dive/local/venv /opt/dive/local/venv
# Copy the source code of the editable module
COPY --from=server-builder /opt/dive/src /opt/dive/src
# Copy the client code into the static source location
COPY --from=client-builder /app/dist/ /opt/dive/clients/dive
COPY --from=girder-client-builder /app/girder/girder/web/dist/ /opt/dive/clients/girder
# Install startup scripts
COPY docker/entrypoint_server.sh docker/server_setup.py /
RUN export GIRDER_STATIC_ROOT_DIR=/opt/dive/clients/girder
ENTRYPOINT [ "/entrypoint_server.sh" ]
