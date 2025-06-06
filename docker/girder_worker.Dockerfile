# ========================
# == SERVER BUILD STAGE ==
# ========================
# ====================
# == FFMPEG FETCHER ==
# ====================
FROM python:3.8-bookworm AS ffmpeg-builder
RUN wget -O ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
RUN mkdir /tmp/ffextracted
RUN tar -xvf ffmpeg.tar.xz -C /tmp/ffextracted --strip-components 1

# =================
# == DIST WORKER ==
# =================
FROM kitware/viame:gpu-algorithms-web AS worker
# VIAME install at /opt/noaa/viame/
# VIAME pipelines at /opt/noaa/viame/configs/pipelines/

# install tini init system
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# Install python
RUN export DEBIAN_FRONTEND=noninteractive && \
  apt update && \
  apt-get install software-properties-common -y && \
  add-apt-repository ppa:deadsnakes/ppa && \
  apt-get update && \
  apt-get install -qy python3.11 libpython3.11 python3.11-venv libc6 build-essential cargo build-essential libssl-dev libffi-dev python3-libtiff libvips-dev libgdal-dev python3-dev npm  && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

RUN ln -fs /usr/bin/python3.10 /usr/bin/python
WORKDIR /opt/dive/src

RUN curl -sSL https://install.python-poetry.org | POETRY_VERSION=1.8.3 POETRY_HOME=/opt/dive/poetry /usr/bin/python3.11 -
ENV PATH="/opt/dive/poetry/bin:$PATH"
# Create a virtual environment for the installation
RUN /usr/bin/python3.11 -m venv --copies /opt/dive/local/venv
# Poetry needs this set to recognize it as ane existing environment
ENV VIRTUAL_ENV="/opt/dive/local/venv"
# Copy only the lock and project files to optimize cache
COPY server/pyproject.toml server/poetry.lock /opt/dive/src/
# Use the system installation
RUN poetry env use /usr/bin/python3.11
# Install dependencies only
RUN poetry install --no-root --verbose
# Build girder client, including plugins like worker/jobs
# RUN girder build

# Copy full source code and install
COPY server/ /opt/dive/src/
    

# Create user "dive" 1099:1099 to align with base image permissions.
# https://github.com/VIAME/VIAME/blob/master/cmake/build_server_docker.sh#L123
RUN useradd --create-home --uid 1099 --shell=/bin/bash dive
# Create a directory for VIAME Addons
RUN install -g dive -o dive -d /tmp/addons
RUN chown -R dive /opt/dive/local/

# Switch to the new user
USER dive
RUN poetry install --only main --verbose

# Copy the built python installation
# Copy ffmpeg
COPY --from=ffmpeg-builder /tmp/ffextracted/ffmpeg /tmp/ffextracted/ffprobe /opt/dive/local/ffmpeg/
# Copy provision scripts
COPY --chown=dive:dive docker/entrypoint_worker.sh /

ENTRYPOINT ["/tini", "--"]
CMD ["/entrypoint_worker.sh"]
