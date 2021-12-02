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

# Hack: Tell GitPython to be quiet, we aren't using git
ENV GIT_PYTHON_REFRESH="quiet"

# Copy site packages and executables
COPY --from=server-builder /usr/local/lib/python3.7/site-packages /usr/local/lib/python3.7/site-packages
COPY --from=server-builder /usr/local/bin/girder /usr/local/bin/girder
COPY --from=server-builder /usr/local/bin/dive /usr/local/bin/dive
# Copy the source code of the editable module
COPY --from=server-builder /home/server/ /home/server/
# Copy the client code into the static source location
COPY --from=server-builder /usr/local/share/girder /usr/local/share/girder
COPY --from=client-builder /app/dist/ /usr/local/share/girder/static/viame/
# Install startup scripts
COPY docker/entrypoint_server.sh docker/server_setup.py /

ENTRYPOINT [ "/entrypoint_server.sh" ]
