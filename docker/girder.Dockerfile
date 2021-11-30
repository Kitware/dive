# V16 needed, see client/README.md
FROM node:16 as client-builder
WORKDIR /app

# Install dependencies
COPY client/package.json client/yarn.lock /app/
RUN yarn install --frozen-lockfile --network-timeout 300000
# Build
COPY .git/ /app/.git/
COPY client/ /app/
RUN yarn build:web


FROM python:3.7-buster as server-builder

WORKDIR /home/server

# https://cryptography.io/en/latest/installation/#debian-ubuntu
RUN apt-get update
RUN apt-get install -y build-essential libssl-dev libffi-dev python3-dev cargo npm
RUN pip install poetry==1.1.12

COPY server/ /home/server/

RUN poetry env use system
RUN poetry config virtualenvs.create false
RUN poetry install
RUN girder build


FROM python:3.7-slim-buster

ENV GIRDER_MONGO_URI mongodb://mongo:27017/girder
ENV CELERY_BROKER_URL amqp://guest:guest@rabbit/

# Install runtime dependencies
RUN apt-get update && \
  apt-get install -qy \
    libffi-dev git && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy the entire python installation
COPY --from=server-builder /usr/local/ /usr/local/
# Copy the source code of the editable module
COPY --from=server-builder /home/server/ /home/server/
# Copy the client code into the static source location
COPY --from=client-builder /app/dist/ /usr/local/share/girder/static/viame/

# Install startup script
COPY docker/provision /home/provision

ENTRYPOINT [ "/home/provision/girder_entrypoint.sh" ]
