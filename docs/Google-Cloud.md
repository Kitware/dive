# Google Cloud

This guide is intended for VIAME Web users who would like to use Google Cloud resources to store and process data.  Your data will live in GCS Buckets and can be analyzed on either Kitware's servers or your own cloud service workers.

![Google Cloud Diagram](images/Diagrams/Google-Cloud.png)

## Concepts

* Kitware maintains [viame.kitware.com](https://viame.kitware.com) web server deployment.
* You own and manage your data in cloud storage buckets.
* (optional) You run worker nodes that process your own personal job queue.

There are several benefits to this configuration:

* Our team can provide support and troubleshooting directly on your data and error logs.
* Our team manages deployments, updates, and maintenance.
* Our team can provide recommendatations for annotation and analysis based on your specific data and needs.

## Support

**For questions or support, please reach out to `viame-web@kitware.com`**

## Google Cloud Storage Mirroring

DIVE Web can mirror your data from google cloud storage buckets such that your team fully controls upload and data organization, but is able to view, annotation, and run analysis on that data in the DIVE platform.

### Creating access credentials

1. Create a new [service account](https://cloud.google.com/iam/docs/creating-managing-service-accounts) with read-only access to the bucket(s) and prefixes that you want to map.
1. In [storage settings](https://console.cloud.google.com/storage/settings), in the interoperability tab, create an access key (Service account HMAC) for your read-only service account.

### Setting up CORS

You'll also need to [configure CORS headers](https://cloud.google.com/storage/docs/configuring-cors) for any buckets where media will be served.

Save the following snippet as `bucket-cors-config.json`.

``` json
[
  {
    "origin": ["https://viame.kitware.com"],
    "method": ["GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

Then use `gsutils` to configure each bucket.

``` bash
gsutil cors set bucket-cors-config.json gs://BUCKET_NAME
```

### Pub/Sub notifications

To keep the mount up-to-date with new data added to your bucket, please create a Pub/Sub subscription on the bucket.

1. [Create a bucket notification configuration](https://cloud.google.com/storage/docs/reporting-changes#enabling)
1. [Create a topic subscription](https://cloud.google.com/pubsub/docs/admin#pubsub_create_pull_subscription-console)
1. [Set a push delivery method for the subsciption](https://cloud.google.com/pubsub/docs/admin#pubsub_create_pull_subscription-console)
    1. The URL for delivery should be `https://viame.kitware.com/api/v1/bucket_notifications/gcs`

Our server will process events from this subscription to keep your data current.

### Choose a mount point

Choose a folder as a mount-point inside DIVE Web.  This folder should ideally be dedicated to mapping from your GCS buckets.

We recommend creating a `Google Cloud Storage` folder with subfolers named for each bucket in your user's workspace.  You can do this using the `New Folder` button in DIVE Web's File Browser.  You can get the folder ID from the browser's URL bar.

### Send us the details

Send an email with the following details from above to `viame-web@kitware.com`.

```text
subject: Add a google cloud storage bucket mount

Bucket name:
Service provider: Google cloud
Access Key: 
Secret Key:
Mount point folder:
Prefix (if applicable):
```

## Running VIAME GPU Workloads

This section will guide you through deploying VIAME to Google Cloud for several use cases.

* Run a GPU worker in Google Cloud (or anywhere you have GPU resources) to process your queue from viame.kitware.com.
* Run VIAME pipelines from the command line

### Preparation

* [Install Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
* [Install Terraform](https://learn.hashicorp.com/tutorials/terraform/install-cli)
* [Install Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html)

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

``` bash
# Authenticate with google cloud
gcloud auth application-default login

# Run plan
# See `devops/main.tf` for a complete list of variables
terraform plan \
  -var "machine_type=e2-small" \
  -var "project_name=<GCloud-Project-Name>"
  -out create.plan

# Run apply
terraform apply create.plan
```

### Provision with Ansible

!!! warning
    The playbook takes 20-30 minutes to run because it must install nvidia drivers, download several GB of software packages, etc.

``` bash
# install galaxy plugins
ansible-galaxy install -r ansible/requirements.yml

# provision
ansible-playbook -i inventory ansible/playbook.yml
```

Once provisioning is complete, jobs should begin processing from the job queue.  You can check [viame.kitware.com/#/jobs](https://viame.kitware.com/#/jobs) to see queue progress and logs.

### Destroying the stack

When your work is complete, use terraform to destroy your resources.

``` bash
terraform destroy
```

## Troubleshooting

* Ansible provisioning is idempotent.  If it fails, run it again once or twice.
* You may need to change the global `GPUS_ALL_REGIONS` quota in [IAM -> Quotas](https://stackoverflow.com/questions/53415180/gcp-error-quota-gpus-all-regions-exceeded-limit-0-0-globally)