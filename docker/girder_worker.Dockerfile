FROM kitware/viame:gpu-all-models-latest
# expects VIAME install at /opt/noaa/viame/
# expects VIAME pipelines at /opt/noaa/viame/configs/pipelines/

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

# install tini init system
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

RUN pip install future

# Pip install dependencies
COPY server/setup.py /home/viame_girder/
RUN pip install --no-cache-dir .

# Pip install actual packages
COPY server/ /home/viame_girder/
RUN pip install --no-deps .

# Switch over to user "worker"
RUN useradd -D --shell=/bin/bash && useradd -m worker
RUN chown -R worker:worker /usr/local/lib/python*
USER worker

ENTRYPOINT ["/tini", "--", "python3.7", "-m", "girder_worker" ]
CMD [ "-l", "info" ]
