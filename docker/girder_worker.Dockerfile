FROM kitware/viame:gpu-algorithms-latest

# install tini init system
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# VIAME install at /opt/noaa/viame/
# VIAME pipelines at /opt/noaa/viame/configs/pipelines/

# BEGIN: Porting girder worker install from girder/girder_worker Dockerfile.py3
RUN export DEBIAN_FRONTEND=noninteractive && \
  apt-get update && \
  apt-get install -qy \
    build-essential \
    wget \
    python3.7 \
    libpython3.7-dev \
    libffi-dev \
    libssl-dev \
    libjpeg-dev \
    zlib1g-dev && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Install ffmpeg 4.4 from https://www.johnvansickle.com/ffmpeg/
RUN \
  wget -O ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
  mkdir ffextracted && \
  tar -xvf ffmpeg.tar.xz -C ffextracted --strip-components 1 && \
  mv ffextracted/ffmpeg ffextracted/ffprobe /usr/local/bin/ && \
  rm -rf ffmpeg.tar.xz ffextracted

# Install pip
RUN \
  wget https://bootstrap.pypa.io/get-pip.py && \
  python3.7 get-pip.py && \
  rm get-pip.py
# END port of worker installation

# Create user "dive" 1099:1099 to align with base image permissions.
# https://github.com/VIAME/VIAME/blob/master/cmake/build_server_docker.sh#L123
RUN useradd --create-home --uid 1099 --shell=/bin/bash dive
# Create a directory for the project files to live
RUN install -g dive -o dive -d /opt/dive

# Switch to the new user and working directory
USER dive
WORKDIR /opt/dive

# Include the local python installation in PATH
ENV PATH="/home/dive/.local/bin:$PATH"

# Create directory for addons
RUN mkdir -p /tmp/addons

# Cryptography requires latest pip
# https://cryptography.io/en/latest/faq.html#installing-cryptography-fails-with-error-can-not-find-rust-compiler
RUN pip install -U pip poetry==1.1.12

# Poetry install dependencies
COPY --chown=dive:dive server/poetry.lock server/pyproject.toml /opt/dive/
RUN poetry env use system
RUN poetry config virtualenvs.create false
RUN poetry install --no-root

# Poetry install actual packages
COPY --chown=dive:dive server/ /opt/dive/
RUN pip install --no-deps .

# Copy provision scripts
COPY --chown=dive:dive docker/provision /opt/dive/provision

ENTRYPOINT ["/tini", "--"]
CMD ["/opt/dive/provision/girder_worker_entrypoint.sh"]
