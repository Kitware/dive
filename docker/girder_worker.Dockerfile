# ========================
# == SERVER BUILD STAGE ==
# ========================
FROM python:3.7-buster as server-builder

WORKDIR /home/server

# https://cryptography.io/en/latest/installation/#debian-ubuntu
RUN apt-get update
RUN apt-get install -y build-essential libssl-dev libffi-dev python3-dev cargo
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

# Copy full source code and install again
COPY server/ /home/server/
RUN poetry install --no-dev

# ======================
# == DIST BUILD STAGE ==
# ======================
FROM kitware/viame:gpu-algorithms-latest

# install tini init system
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# VIAME install at /opt/noaa/viame/
# VIAME pipelines at /opt/noaa/viame/configs/pipelines/

# Install runtime dependencies
RUN export DEBIAN_FRONTEND=noninteractive && \
  apt-get update && \
  apt-get install -qy \
    wget \
    libjpeg-dev \
    python3.7 \
    zlib1g-dev && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Install ffmpeg 4.4 from https://www.johnvansickle.com/ffmpeg/
RUN \
  wget -O ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
  mkdir ffextracted && \
  tar -xvf ffmpeg.tar.xz -C ffextracted --strip-components 1 && \
  mv ffextracted/ffmpeg ffextracted/ffprobe /usr/local/bin/ && \
  rm -rf ffmpeg.tar.xz ffextracted

# Create user "dive" 1099:1099 to align with base image permissions.
# https://github.com/VIAME/VIAME/blob/master/cmake/build_server_docker.sh#L123
RUN useradd --create-home --uid 1099 --shell=/bin/bash dive
# Create a directory for VIAME Addons
RUN install -g dive -o dive -d /tmp/addons

# Switch to the new user
USER dive

# Copy installation from site packages
# Note that dist-packages is used because python was installed via package manager
COPY --chown=dive:dive --from=server-builder /usr/local/lib/python3.7/site-packages /usr/local/lib/python3.7/dist-packages
# Copy the source code of the editable module
COPY --chown=dive:dive --from=server-builder /home/server/ /home/server/
# Copy provision scripts
COPY --chown=dive:dive docker/entrypoint_worker.sh /

ENTRYPOINT ["/tini", "--"]
CMD ["/entrypoint_worker.sh"]
