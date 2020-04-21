FROM kitware/viame:girder-worker-gpu-latest

USER root

WORKDIR /home

RUN cd /viame/cmake \
	&& chmod +x build_server_ubuntu.sh \
        && sleep 1 \
 	&& ./build_server_ubuntu.sh

RUN git clone https://github.com/VIAME/VIAME-Web.git /viame-web \
	&& mv /viame-web/docker/provision provision \
	&& mv /viame-web/server viame_girder 

RUN cd viame_girder && pip install --no-cache-dir -e .

USER worker

CMD girder-worker -l info
