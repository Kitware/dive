FROM kitware/viame:gpu-algorithms-latest

# install tini init system
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# VIAME install at /opt/noaa/viame/
# VIAME pipelines at /opt/noaa/viame/configs/pipelines/

ENV CELERY_BROKER_URL amqp://guest:guest@rabbit/
ENV BROKER_CONNECTION_TIMEOUT 2

WORKDIR /home/viame_girder

# BEGIN: Porting girder worker install from girder/girder_worker Dockerfile.py3
RUN apt-get update && \
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

# Initialize python virtual environment
RUN apt-get update && apt-get install -y python3.7-venv

# Switch over to user "worker"
RUN useradd -D --shell=/bin/bash && useradd -m worker
USER worker

ENV VIRTUAL_ENV=/home/worker/venv
RUN python3.7 -m venv $VIRTUAL_ENV

# Activate the venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Cryptography requires latest pip, setuptools.
# https://cryptography.io/en/latest/faq.html#installing-cryptography-fails-with-error-can-not-find-rust-compiler
RUN pip install -U pip setuptools

# Pip install dependencies
COPY --chown=worker:worker server/setup.py /home/viame_girder/
RUN pip install --no-cache-dir .

# Pip install actual packages
COPY --chown=worker:worker server/ /home/viame_girder/
RUN pip install --no-deps .

# Copy provision scripts
COPY --chown=worker:worker docker/provision /home/provision

# Download addons
USER root
RUN /opt/noaa/viame/bin/download_viame_addons.sh \
  && /opt/noaa/viame/bin/filter_non_web_pipelines.sh \
  && chown -R worker:worker /opt/noaa/viame/

USER worker

ENTRYPOINT ["/tini", "--"]
CMD ["/home/provision/girder_worker_entrypoint.sh"]
