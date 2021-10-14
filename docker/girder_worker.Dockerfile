FROM kitware/viame:gpu-algorithms-latest

# install tini init system
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# VIAME install at /opt/noaa/viame/
# VIAME pipelines at /opt/noaa/viame/configs/pipelines/

# BEGIN: Porting girder worker install from girder/girder_worker Dockerfile.py3
RUN apt-get update && \
  apt-get install -qy software-properties-common && \
  add-apt-repository ppa:savoury1/ffmpeg4 && \
  apt-get update && \
	export DEBIAN_FRONTEND=noninteractive && \
  apt-get install -qy software-properties-common python3-software-properties && \
  apt-get update && apt-get install -qy \
    build-essential \
    wget \
    python3.7 \
    r-base \
    libffi-dev \
    libssl-dev \
    libjpeg-dev \
    zlib1g-dev \
    r-base \
    ffmpeg \
    libpython3.7-dev && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

RUN wget https://bootstrap.pypa.io/get-pip.py && python3.7 get-pip.py
# END port of worker installation

# Switch over to user "worker" 1099:1099 to align with base image
# https://github.com/VIAME/VIAME/blob/master/cmake/build_server_docker.sh#L123
RUN useradd --create-home --uid 1099 --shell=/bin/bash dive
USER dive
WORKDIR /home/dive

# Create directory for addons
RUN mkdir -p /tmp/addons

# Add dive user's local bin to PATH
ENV PATH="/home/dive/.local/bin:$PATH"

# Cryptography requires latest pip, setuptools.
# https://cryptography.io/en/latest/faq.html#installing-cryptography-fails-with-error-can-not-find-rust-compiler
RUN pip install -U pip setuptools

# Pip install dependencies
COPY --chown=dive:dive server/setup.py /home/dive/
RUN pip install --no-cache-dir .

# Pip install actual packages
COPY --chown=dive:dive server/ /home/dive/
RUN pip install --no-deps .

# Copy provision scripts
COPY --chown=dive:dive docker/provision /home/provision

ENTRYPOINT ["/tini", "--"]
CMD ["/home/provision/girder_worker_entrypoint.sh"]
