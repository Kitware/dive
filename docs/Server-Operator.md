> Why is the healthcheck in docker compose needed?

So that the worker images aren't started immediately after the girder image. Since the girder image actually installs girder, and then runs girder serve, the workers can start before it, and try to re-run existing tasks, failing them because girder isn't running.