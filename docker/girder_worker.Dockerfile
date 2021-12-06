# ========================
# == SERVER BUILD STAGE ==
# ========================
# Note: server-builder stage will be the same in both dockerfiles
FROM python:3.7-buster as server-builder

WORKDIR /opt/dive/src

# https://cryptography.io/en/latest/installation/#debian-ubuntu
RUN apt-get update
RUN apt-get install -y build-essential libssl-dev libffi-dev python3-dev cargo npm
# Recommended poetry install https://python-poetry.org/docs/master/#installation
RUN curl -sSL https://install.python-poetry.org | POETRY_VERSION=1.1.2 POETRY_HOME=/opt/dive/local python -
ENV PATH="/opt/dive/local/venv/bin:$PATH"
# Copy only the lock and project files to optimize cache
COPY server/pyproject.toml server/poetry.lock /opt/dive/src/
# Use the system installation
RUN poetry env use system
RUN poetry config virtualenvs.create false
# Install dependencies only
RUN poetry install --no-root
# Build girder client, including plugins like worker/jobs
# RUN girder build

# Copy full source code and install
COPY server/ /opt/dive/src/
RUN poetry install --no-dev

# ====================
# == FFMPEG FETCHER ==
# ====================
FROM python:3.7-buster as ffmpeg-builder
RUN wget -O ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
RUN mkdir /tmp/ffextracted
RUN tar -xvf ffmpeg.tar.xz -C /tmp/ffextracted --strip-components 1

# =================
# == DIST WORKER ==
# =================
FROM kitware/viame:gpu-algorithms-latest as worker
# VIAME install at /opt/noaa/viame/
# VIAME pipelines at /opt/noaa/viame/configs/pipelines/

# install tini init system
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# Install python
RUN export DEBIAN_FRONTEND=noninteractive && \
  apt-get update && \
  apt-get install -qy python3.7 libpython3.7 && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Create user "dive" 1099:1099 to align with base image permissions.
# https://github.com/VIAME/VIAME/blob/master/cmake/build_server_docker.sh#L123
RUN useradd --create-home --uid 1099 --shell=/bin/bash dive
# Create a directory for VIAME Addons
RUN install -g dive -o dive -d /tmp/addons

# Switch to the new user
USER dive

# Setup the path of the incoming python installation
ENV PATH="/opt/dive/local/venv/bin:$PATH"

# Copy the built python installation
COPY --chown=dive:dive --from=server-builder /opt/dive/local/venv/ /opt/dive/local/venv/
# Copy the source code of the editable module
COPY --chown=dive:dive --from=server-builder /opt/dive/src /opt/dive/src
# Copy ffmpeg
copy --from=ffmpeg-builder /tmp/ffextracted/ffmpeg /tmp/ffextracted/ffprobe /opt/dive/local/venv/bin/
# Copy provision scripts
COPY --chown=dive:dive docker/entrypoint_worker.sh /

ENTRYPOINT ["/tini", "--"]
CMD ["/entrypoint_worker.sh"]
