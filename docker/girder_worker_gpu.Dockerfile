# ========================
# == SERVER BUILD STAGE ==
# ========================
# ====================
# == FFMPEG FETCHER ==
# ====================
# BtbN FFmpeg 7.1 release-branch builds (not git master). Supports -/headers so
# Girder tokens need not appear in ffprobe argv. See:
# https://github.com/BtbN/FFmpeg-Builds/releases/latest
FROM python:3.11-bookworm AS ffmpeg-builder
RUN apt-get update && apt-get install -qy --no-install-recommends wget ca-certificates xz-utils \
  && rm -rf /var/lib/apt/lists/*
RUN wget -O /tmp/ffmpeg.tar.xz \
  https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz \
  && mkdir /tmp/ffextracted \
  && tar -xvf /tmp/ffmpeg.tar.xz -C /tmp/ffextracted --strip-components 1 \
  && rm /tmp/ffmpeg.tar.xz

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



# VIAME tooling expects `python` to stay on the image default (3.10).
RUN ln -fs /usr/bin/python3.10 /usr/bin/python
WORKDIR /opt/dive/src

# Use a globally accessible uv binary (works before/after USER switch)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# Install interpreter outside /root so user `dive` can run the venv (see USER dive below).
ENV UV_PYTHON_INSTALL_DIR=/opt/dive/local/uv-python
ENV UV_PYTHON=3.11
RUN uv python install 3.11
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
# Copy ffmpeg (BtbN layout: bin/ffmpeg, bin/ffprobe)
COPY --from=ffmpeg-builder /tmp/ffextracted/bin/ffmpeg /tmp/ffextracted/bin/ffprobe /opt/dive/local/ffmpeg/
# Copy provision scripts
COPY --chown=dive:dive docker/entrypoint_worker.sh /

ENTRYPOINT ["/tini", "--"]
CMD ["/entrypoint_worker.sh"]
