# Cloud Deployment Guide

!!! note

    Be sure to read the [Deployment Overview](Deployment-Overview.md) first.

* **Scenario 1**: Deploy your own instance of VIAME Web to GCP Compute Engine.
* **Scenario 2**: Run VIAME pipelines on a GCP Compute Engine VM from the command line.
* **Scenario 3**: Run a Private GPU worker in GCP to process jobs from any VIAME Web instance including viame.kitware.com (standalone mode)

The terraform section is the same for all scenarios.  The Ansible section will have differences.

## Before you begin

You'll need a GCP Virtual Machine (VM) with the features listed below.  This section will guide you through creating one and deploying VIAME using [Terraform](https://www.terraform.io/) and [Ansible](https://www.ansible.com/).  If you do not want to use these tools, you can create your own VM through the management console and skip to [the docker documentation instead](Deployment-Docker-Compose.md).

| Feature | Recommended value |
|---------|-------------------|
| Operating system | Ubuntu 20.04 |
| Instance Type | `n1-standard-4` or larger |
| GPU Type | `nvidia-tesla-t4`, `nvidia-tesla-p4`, or similar |
| Disk Type | SSD, 128GB or more depending on your needs |

## Preparation

To run the provisioning tools below, you need the following installed on your workstation.

!!! note

    Google Cloud worker provisioning can **only be done** from an Ubuntu Linux 18.04+ host.  Ansible and terraform should work on Windows Subsystem for Linux (WSL) if you only have a windows host.  You could also use a cheap CPU-only cloud instance to run these tools.

* [Install Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
* [Install Terraform](https://learn.hashicorp.com/tutorials/terraform/install-cli)
* [Install Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html)
* Find your google cloud project id.  It looks like `project-name-123456`.

!!! tip

    Google Cloud imposes GPU Quotas.  You may need to [request a quota increase](https://cloud.google.com/compute/quotas).  Anecdotally, request increases of 1 unit are approved automatically, but more are rejected.

## Creating a VM with Terraform

``` bash
# Clone the dive repo
git clone https://github.com/Kitware/dive.git
cd dive/devops

# Generate a new ssh key
ssh-keygen -t ed25519 -f ~/.ssh/gcloud_key
```

### Run Terraform

!!! warning

    GPU-accelerated VMs are significantly more expensive than typical VMs.  Make sure you are familiar with the cost of the machine and GPU you choose.  See main.tf for default values.

See `devops/main.tf` for a complete list of variables.  The default `machine_type`, `gpu_type`, and `gpu_count` can be overridden.

``` bash
# Authenticate with google cloud
gcloud auth application-default login

# Verify your GPU Quota
# https://cloud.google.com/compute/docs/gpus/create-vm-with-gpus
# REGION might change.
gcloud compute regions describe us-central1

# Run plan, providing any variables you choose
terraform plan \
    -var "project_name=<GCloud-Project-Id>" \
    -var "gpu_count=1" \
    -out create.plan

# Run apply.  It may take several minutes
terraform apply create.plan
```

### Destroy the stack

Later, when you are done with the server and have backed up your data, use terraform to destroy your resources.

``` bash
terraform destroy -var "project_name=<GCloud-Project-Id>"
```

## Configure with Ansible

This step will prepare the new host to run a VIAME worker by installing nvidia drivers, docker, and downloading VIAME and all optional addons.

!!! warning

    The playbook may take 30 minutes or more to run because it must install nvidia drivers and download several GB of software packages.

### Ansible Extra Vars

These are all the variables that can be provided with `--extra-vars` along with which scenario each on applies to.

| Variable | Default | Description |
|----------|---------|-------------|
| run_server | `no` | Set `run_server=yes` for scenario 1 (deploy your own) |
| run_viame_cli | `no` | Set `run_viame_cli=yes` for scenario 2 (VIAME CLI) |
| run_worker_container | `no` | Set `run_worker_container=yes` for scenario 3 (standalone worker) |
| viame_bundle_url | latest bundle url | Optional for scenario 2 & 3.  Change to install a different version of VIAME.  This should be a link to the latest Ubuntu Desktop (18/20) binaries from viame.kitware.com (Mirror 1) |
| DIVE_USERNAME | null | Required for scenario 3. Username to start private queue processor |
| DIVE_PASSWORD | null | Required for scenario 3. Password for private queue processor |
| WORKER_CONCURRENCY | `2` | Optional for scenario 3. Max concurrnet jobs. **Change this to 1 if you run training** |
| DIVE_API_URL  | `https://viame.kitware.com/api/v1` | Optional for scenario 3. Remote URL to authenticate against. |
| KWIVER_DEFAULT_LOG_LEVEL | `warn` | Optional for scenario 3. kwiver log level |

### Run Ansible

The examples below assumes the `inventory` file was created by Terraform above.

``` bash
# install galaxy plugins
ansible-galaxy install -r ansible/requirements.yml

# Scenario 1 Example
ansible-playbook -i inventory ansible/playbook.yml --extra-vars "run_server=yes"

# Scenario 2 Example
ansible-playbook -i inventory ansible/playbook.yml --extra-vars "run_viame_cli=yes"

# Scenario 3 Example
ansible-playbook -i inventory ansible/playbook.yml --extra-vars "run_worker_container=yes DIVE_USERNAME=username DIVE_PASSWORD=changeme"
```

Once provisioning is complete, jobs should begin processing from the job queue.  You can check [viame.kitware.com/#/jobs](https://viame.kitware.com/#/jobs) to see queue progress and logs.

!!! tip
    This ansible playbook is runnable from any Ubuntu 18.04+ host to any Ubuntu 18.04+ target.  To run it locally, use the `inventory.local` file instead.  If you already have nvidia or docker installed, you can comment out these lines in the playbook.

    ```bash
    ansible-playbook --ask-become-pass -i inventory ansible/playbook.yml --extra-vars "<see above>"
    ```

### Check that it worked

``` bash
# Log in with the ip address from the inventory file (or google cloud dashboard)
ssh -i ~/.ssh/gcloud_key viame@ip-address

# Test nvidia docker installation
docker run --runtime=nvidia --rm nvidia/cuda nvidia-smi

# Test regular nvidia runtime
nvidia-smi

# For Scenario 2 and 3, check KWIVER installation
cd /opt/noaa/viame
source setup_viame.sh
kwiver

# For Scenario 3, you can check to see if the worker is started
# You should see "celery@identifier ready." in the logs
sudo docker logs -f worker
```

You can [enable your private queue on the jobs page](https://viame.kitware.com/#jobs) and begin running jobs.

## Next Steps

* **Scenario 1**: Proceed to [Docker Compose Deployment](Deployment-Docker-Compose.md).
* **Scenario 2**: Setup is complete.  Proceed to the [VIAME Documentation](https://github.com/VIAME/VIAME#documentation).
* **Scenario 3**: Setup is complete.  Make sure your private queue is enabled.

## Troubleshooting

* Ansible provisioning is idempotent.  If it fails, run it again once or twice.
* You may need to change the global `GPUS_ALL_REGIONS` quota in [IAM -> Quotas](https://stackoverflow.com/questions/53415180/gcp-error-quota-gpus-all-regions-exceeded-limit-0-0-globally)
