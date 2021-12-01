# ========================
# == CLIENT BUILD STAGE ==
# ========================
FROM node:16 as client-builder
WORKDIR /app

# Install dependencies
COPY client/package.json client/yarn.lock /app/
RUN yarn install --frozen-lockfile --network-timeout 300000
# Build
COPY .git/ /app/.git/
COPY client/ /app/
RUN yarn build:web

# ========================
# == SERVER BUILD STAGE ==
# ========================
FROM python:3.7-buster as server-builder

WORKDIR /home/server

# https://cryptography.io/en/latest/installation/#debian-ubuntu
RUN apt-get update
RUN apt-get install -y build-essential libssl-dev libffi-dev python3-dev cargo npm
# Recommended poetry install https://python-poetry.org/docs/#installation
RUN curl -sSL https://raw.githubusercontent.com/python-poetry/poetry/master/get-poetry.py | python -
ENV PATH="/root/.poetry/bin:$PATH"

# Copy only the lock and project files
COPY server/pyproject.toml server/poetry.lock /home/server/
# Use the system python installation
RUN poetry env use system
# Skip creating a virtual env, just put stuff in /usr/local
RUN poetry config virtualenvs.create false
# Install dependencies only
RUN poetry install --no-root --no-dev
# Build girder client, including plugins like worker/jobs
RUN girder build

# Copy full source code and install
COPY server/ /home/server/
RUN poetry install --no-dev

# ======================
# == DIST BUILD STAGE ==
# ======================
FROM python:3.7-slim-buster

# Install runtime dependencies (dynamically linked)
RUN apt-get update && \
  apt-get install -qy \
    git && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy site packages
COPY --from=server-builder /usr/local/lib/python3.7/site-packages /usr/local/lib/python3.7/site-packages
# Copy girder executable
COPY --from=server-builder /usr/local/bin/girder /usr/local/bin/girder
# Copy the source code of the editable module
COPY --from=server-builder /home/server/ /home/server/
# Copy the client code into the static source location
COPY --from=client-builder /app/dist/ /usr/local/share/girder/static/viame/
# Install startup script
COPY docker/entrypoint_server.sh docker/server_setup.py /home/server/

ENTRYPOINT [ "/home/server/entrypoint_server.sh" ]
