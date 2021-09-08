# Cloud Deployment Guide

!!! info
    Be sure to read the [Deployment Overview](Deployment-Overview.md) page first.

This section will guide you through deploying VIAME to Google Cloud for several use cases.

* **Scenario 1**: Deploy your own instance of VIAME Web to GCP Compute Engine.
* **Scenario 2**: Run VIAME pipelines on a GCP Compute Engine VM from the command line.
* **Scenario 3**: Run a Private GPU worker in GCP to process jobs from any VIAME Web instance (including viame.kitware.com)

!!! info
    If you want to run a GPU worker or the whole VIAME Web stack to an existing server, [see the docker documentation instead](https://github.com/Kitware/dive/blob/main/docker/README.md).

## Preparation

To run the provisioning tools below, you need the following installed on your workstation.

!!! warning

    Google Cloud worker provisioning can **only be done** from an Ubuntu Linux 18.04+ host.  Ansible and terraform should work on Windows Subsystem for Linux (WSL) if you only have a windows host.  You could also use a cheap CPU-only cloud instance to run these tools.

!!! warning

    Google Cloud imposes GPU Quotas.  You may need to [request a quota increase](https://cloud.google.com/compute/quotas).  Anecdotally, request increases of 1 unit are approved automatically, but more are rejected.

* [Install Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
* [Install Terraform](https://learn.hashicorp.com/tutorials/terraform/install-cli)
* [Install Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html)
* find your google cloud project id.  It looks like `project-name-123456`.

## Creating a new Google Cloud VM

``` bash
# Clone the dive repo
git clone https://github.com/Kitware/dive.git
cd dive/devops

# Install ansible
pip3 install ansible

# Generate an ssh key
ssh-keygen -t ed25519 -f ~/.ssh/gcloud_key
```

### Run Terraform

!!! warning

    GPU resources cost money.  Make sure you are familiar with the cost of the machine and gpu you choose.  See main.tf for default values.

``` bash
# Authenticate with google cloud

gcloud auth application-default login

# Verify your GPU Quota
# https://cloud.google.com/compute/docs/gpus/create-vm-with-gpus
# REGION might change.

gcloud compute regions describe us-central1

# Run plan
# See `devops/main.tf` for a complete list of variables
# the default macine_type and gpu_type can be overridden

terraform plan -var "project_name=<GCloud-Project-Id>" -out create.plan

# Run apply
terraform apply create.plan
```

### Destroy the stack

Later, when your work is complete, use terraform to destroy your resources.

``` bash
terraform destroy -var "project_name=<GCloud-Project-Id>"
```

## Provision with Ansible

This step will prepare the new host to run a VIAME worker by installing nvidia drivers, docker, and downloading VIAME and all optional addons.

!!! warning

    The playbook may take 30 minutes or more to run because it must install nvidia drivers and download several GB of software packages.

### Extra Vars

The supported extra vars to pass to ansible.

| Variable | Default | Description |
|----------|---------|-------------|
| DIVE_USERNAME | null | Required. Username to start private queue processor |
| DIVE_PASSWORD | null | Required. Password for private queue processor |
| WORKER_CONCURRENCY | `2` | Optional. max concurrnet jobs. **Change this to 1 if you run training** |
| KWIVER_DEFAULT_LOG_LEVEL | `warn` | Optional. kwiver log level |
| DIVE_API_URL  | `https://viame.kitware.com/api/v1` | Optional. Remote URL to authenticate against. |
| viame_bundle_url | latest bundle url | Optional.  Change to install a different version of VIAME.  This should be a link to the latest Ubuntu Desktop (18/20) binaries from viame.kitware.com (Mirror 1) |

``` bash
# install galaxy plugins
ansible-galaxy install -r ansible/requirements.yml

# provision using inventory file automatically created by terraform and the connection string you got from us
ansible-playbook -i inventory ansible/playbook.yml --extra-vars "DIVE_USERNAME=username DIVE_PASSWORD=changeme"
```

Once provisioning is complete, jobs should begin processing from the job queue.  You can check [viame.kitware.com/#/jobs](https://viame.kitware.com/#/jobs) to see queue progress and logs.

### Digression: Provision local hardware with Ansible

If you want to run the VIAME Worker node on a workstation, shared server, or in another cloud environment, you can run the worker in standalone mode using the [docker docs](https://github.com/Kitware/dive/tree/main/docker#running-the-gpu-job-runner-in-standalone-mode). You may even still be able to provision the target host using this ansible playbook.

This ansible playbook is runnable from any Ubuntu 18.04+ host to any Ubuntu 18.04+ target.  To run it locally, use the `inventory.local` file instead.  If you already have nvidia or docker installed, you can comment out these lines in the playbook.

```bash
ansible-playbook --ask-become-pass -i inventory ansible/playbook.yml --extra-vars "DIVE_USERNAME=username DIVE_PASSWORD=changeme"
```

### Checking that it worked

``` bash
# Log in with the ip address from the inventory file (or google cloud dashboard)
ssh -i ~/.ssh/gcloud_key viame@ip-address

# See if viame started
# You should see "celery@identifier ready." in the logs
sudo docker logs -f worker
```

You can [enable your private queue on the jobs page](https://viame.kitware.com/#jobs) and begin running jobs.

## Troubleshooting

* Ansible provisioning is idempotent.  If it fails, run it again once or twice.
* You may need to change the global `GPUS_ALL_REGIONS` quota in [IAM -> Quotas](https://stackoverflow.com/questions/53415180/gcp-error-quota-gpus-all-regions-exceeded-limit-0-0-globally)
