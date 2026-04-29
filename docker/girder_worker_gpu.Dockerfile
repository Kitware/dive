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
# == GPU WORKER ==
# =================
FROM kitware/viame:gpu-algorithms-web AS worker
# VIAME install at /opt/noaa/viame/
# VIAME pipelines at /opt/noaa/viame/configs/pipelines/

# install tini init system
ENV TINI_VERSION=v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# Install python
RUN export DEBIAN_FRONTEND=noninteractive && \
  apt update && \
  apt-get install software-properties-common -y && \
  add-apt-repository ppa:deadsnakes/ppa && \
  apt-get update && \
  apt-get install -qy python3.11 libpython3.11 python3.11-venv libc6 build-essential cargo build-essential libssl-dev libffi-dev python3-libtiff libvips-dev libgdal-dev python3-dev npm git && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

RUN ln -fs /usr/bin/python3.10 /usr/bin/python
WORKDIR /opt/dive/src

# Use a globally accessible uv binary (works before/after USER switch)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV VIRTUAL_ENV="/opt/dive/local/venv"
ENV UV_PROJECT_ENVIRONMENT=/opt/dive/local/venv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN uv venv /opt/dive/local/venv
ENV PATH="/opt/dive/local/venv/bin:/usr/local/bin:$PATH"
# Copy only the lock and project files to optimize cache
COPY server/pyproject.toml server/uv.lock /opt/dive/src/
# Install dependencies only
RUN uv sync --frozen --no-install-project --no-dev

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
RUN uv sync --frozen --no-dev

# Copy the built python installation
# Copy ffmpeg
COPY --from=ffmpeg-builder /tmp/ffextracted/ffmpeg /tmp/ffextracted/ffprobe /opt/dive/local/ffmpeg/
# Copy provision scripts
COPY --chown=dive:dive docker/entrypoint_worker.sh /

ENTRYPOINT ["/tini", "--"]
CMD ["/entrypoint_worker.sh"]
