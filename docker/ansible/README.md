# Deployment Guide

This folder contains the deployment configuration for DIVE.

Typically ansible is run using `ansible-playbook` over `ssh`, however since the server this is deployed on isn't accessable via `ssh`, we can't use normal CI/Deployment methods. Instead, ansible needs to be run with a `systemd` timer, and this `systemd` timer needs to be setup locally. Due to the uptime requirements, this deployment is run on a schedule, instead of directly after changes to the `main` branch.

## Requirements

The server must have the following things:

- The repository cloned to `/home/viame`
- Ansible
- The Ansible [Docker Compose](https://docs.ansible.com/ansible/latest/modules/docker_compose_module.html) module

## systemd service

To initiate the `systemd` timer, run the following command:

``` bash
ansible-playbook docker/ansible/systemd.yml
```

If you need to remove this timer and service, run the following command:

``` bash
ansible-playbook docker/ansible/clean.systemd.yml
```

## Operation

Once the service is initiated, it will run the `deploy.yml` playbook at the interval specified in `viame-deploy.timer`. This will update the server with any changes.

`deploy.yml` will read in variables from `.vars.yml`. These are not tracked in source control, as they're assumed to contain sensitive information. The following variables are expected to be defined in `.vars.yml`:

- `deploy_email_address` - The email address that the emails will be sent from
- `notify_email_address` - The email address that the emails will be sent to
- `project_directory` - The directory on the local machine that the project is located

## Notes

- The `project_directory` variable is used as a convienience for developers, but the `viame-deploy.service` file still contains a hardcoded reference to `home/viame`. If trying to use the service/timer in a local setup under a different directory, you will need to edit the `viame-deploy.service` file by hand.
- While the default for the `COMPOSE_PROJECT_NAME` env var is `viame_web`, for legacy reasons, the production server uses `COMPOSE_PROJECT_NAME=docker` (the default supplied by `docker-compose` itself). Due to this, the `deploy.yml` file has a hardcoded use of the `docker_pipelines` volume. If you are running these scripts in a separate deploy, you may need to either change this use in the `deploy.yml`, or set `COMPOSE_PROJECT_NAME=docker`
