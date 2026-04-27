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

# ========================
# == SERVER BUILD STAGE ==
# ========================
# Note: server-builder stage will be the same in both dockerfiles
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS server-builder
SHELL ["/bin/bash", "-c"]

WORKDIR /opt/dive/src
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
ENV VIRTUAL_ENV="/opt/dive/local/venv"
ENV UV_PROJECT_ENVIRONMENT=/opt/dive/local/venv
ENV PATH="/opt/dive/local/venv/bin:$PATH"
RUN uv venv /opt/dive/local/venv

# Copy only the lock and project files to optimize cache
COPY server/pyproject.toml server/uv.lock /opt/dive/src/
RUN uv sync --frozen --no-install-project --no-dev --extra large-image
# Install Node.js (kept for any plugin/frontend build tooling invoked by deps)
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash

# Default node version
RUN . ~/.bashrc && \
    nvm install 14 && \
    nvm alias default 14 && \
    nvm use default && \
    ln -s $(dirname `which npm`) /usr/local/node

ENV PATH="/usr/local/node:$PATH"

# Copy full source code and install
COPY server/ /opt/dive/src/
RUN uv sync --frozen --no-dev --extra large-image
RUN uv run girder build

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
COPY --from=client-builder /app/dist/ /opt/dive/local/venv/share/girder/static/viame/
# Copy uv binary for runtime use
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# Install startup scripts
COPY docker/entrypoint_server.sh docker/server_setup.py /

ENTRYPOINT [ "/entrypoint_server.sh" ]
