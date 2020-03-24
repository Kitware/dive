## Development

Install https://github.com/Kitware/ldc

```bash
# copy .env.example and make any changes
cp .env.example .env

# bring the server up
ldc up

# replace a pre-built image with the development version
# for example, here's how to work on the girder server code
ldc dev girder

# stop all containers and remove their volumes
ldc clean
```

To work on the Vue client, see development instructions in `./client`.
