This folder contains the deployment configuration for Viame-Web

# Requirements
The server must have the following things:
- The repository cloned to `/home/viame`
- Ansible
- The Ansible [Docker Compose](https://docs.ansible.com/ansible/latest/modules/docker_compose_module.html) module


# systemd service
To initiate the systemd timer, run the following command:

```
ansible-playbook docker/ansible/systemd.yml
```

If you need to remove this timer and service, run the following command:

```
ansible-playbook docker/ansible/clean.systemd.yml
```

# Operation
Once the service is initiated, it will run the `deploy.yml` playbook at the interval specified in `viame-deploy.timer`. This will update the server with any changes.
