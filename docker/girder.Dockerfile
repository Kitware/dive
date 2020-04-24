FROM node:latest as builder
WORKDIR /app
# Install dependencies
COPY client/package.json client/yarn.lock /app/
RUN yarn --frozen-lockfile
# Build
COPY .git/ /app/.git/
COPY client/ /app/
RUN yarn build


FROM python:3.7-slim as runtime
EXPOSE 8080
# Set environment to support Unicode: http://click.pocoo.org/5/python3/#python-3-surrogate-handling
ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8
WORKDIR /girder
COPY --from=girder/girder:latest /girder/ /girder/
# avoid psutil GCC dependency by using unofficial large_image wheel
RUN apt-get update \
  && apt-get install -qy git \
  && pip install \
    --no-cache-dir \
    --find-links https://girder.github.io/large_image_wheels \
    --upgrade-strategy eager . \
  && apt-get remove --purge -qy git \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /girder/.git
COPY --from=girder/girder:latest /usr/share/girder/static/ /usr/local/share/girder/static/

WORKDIR /home
# modify this based on where you are running docker-compose from
COPY docker/provision provision
COPY server viame_girder
RUN cd viame_girder && pip install --no-cache-dir .
# Bring in the client from girder
COPY --from=builder /app/dist/ /usr/local/share/girder/static/viame/

ENTRYPOINT ["/home/provision/girder_entrypoint.sh"]
