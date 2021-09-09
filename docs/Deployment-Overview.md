# Deployment Overview

The goal of this page is to provide an overview of the ways to run VIAME or VIAME Web in various types of compute environments.

## Contents

* [Using our deployment of VIAME Web](#using-our-public-server)
* [Running your own instance of VIAME Web](#running-your-own-instance)
* [Using the VIAME command line and project folders in a cloud environment](#viame-cli-with-project-folders)
* [Hybrid options for using local or cloud compute resources with an existing deployment](#hybrid-options-for-compute)
* [Hybrid options for integrating data from cloud storage such as GCP Buckets or S3 into an existing deployment](#hybrid-options-for-storage)

## Our server vs running your own

| Using our server | Running your own |
|----------|-----------|
Free to use; no maintenance costs | You pay hosting and maintenance costs |
Always up to date | Possible to configure automated updates |
One shared enviornment for everyone | Your organization has full control over access |
Our team monitors this service for errors and can respond to issues proactively | Support by email requires logs, screenshots, and other error information if applicable
Our team can provide guidance on annotaiton and training because we have direct access to your data | Support by email usually requires example data and annotations
Having user data in our environment helps us understand user needs and improve the product | Feedback by email is always appreciated.
Limited shared compute resources (2 GPUs) available to process jobs. Can be mitigated by hybrid compute options | As much compute as you pay for

## Using our public server

The easiest option to get started using VIAME is to [try our public server](Web-Version.md).

## Running your own instance

You may wish to run your own deployment of VIAME Web in your lab or a cloud environment.  Deploying VIAME Web is relatively straighforward with `docker-compose`.

| Environment | Instructions |
|-------------|--------------|
**Local server** | If you already have SSH access to an existing server and `sudo` permissions, [proceed to the docker compose guide](Deployment-Docker-Compose.md).
**Google&nbsp;Cloud** | Continue to the [Provisioning Google Cloud](Deployment-Provision.md) page for `Scenario 1` |
**AWS / Azure** | Create a server on your own through the cloud management console, then [proceed to the docker compose guide](Deployment-Docker-Compose.md).

## VIAME CLI with project folders

You may not want to use the web annotator and job orchestration at all, and instead run VIAME using the command line in a cloud environment with GPU.

| Environment | Instructions |
|-------------|--------------|
**Local server** | This is a standard VIAME install.  See the [VIAME documentation install instructions](https://github.com/VIAME/VIAME).
**Google&nbsp;Cloud** | Continue to the [Provisioning Google Cloud](Deployment-Provision.md) page for `Scenario 2` |
**AWS / Azure** | Create a server through the cloud management console, then [proceed to the VIAME documentation install instructions](https://github.com/VIAME/VIAME).

## Hybrid options for compute

Instead of running the whole web stack, it's possible to deploy a worker by itself to process compute-intensive jobs.  This is referred to in the docs as **standalone mode**. For example, you could:

* Upload and annotate at viame.kitware.com, but run your own **private** worker on a lab workstation
* Deploy your own web server to a local lab workstation, but process your jobs in an ephemeral Google Cloud VM.

**How it works**

* You must [toggle your private queue](https://viame.kitware.com/#jobs)
* When you launch jobs (like transcoding, pipelines, or training), they go into a special queue just for your user account.
* You are responsible for running a worker.  Your worker is a Celery process that will connect to our public RabbitMQ server.
* Jobs submitted through the interface at viame.kitware.com will run on your compute resources.  This involves automatically downloading the video or images and annotation files, running a kwiver pipeline, and uploading the results.

To set up a private worker, continue to the [Provisioning Google Cloud](Deployment-Provision.md) page for `Scenario 3`.

## Hybrid options for storage

Any instance of VIAME Web, including our public server, can connect to S3-compatible storage.  This means your lab or group could make your existing data avaible at [viame.kitware.com](https://viame.kitware.com), either privately or publicly.

| Storage Product | Support level |
|-----------------|---------------|
Google Cloud Buckets | Use as backing storage, import existing data, monitor for changes and automatically discover new uploads
AWS S3 | Use as backing storage, import existing data
MinIO | Use as backing storage, import existing data
Azure Blob Storage | Limited import support using [MinIO Azure Gateway](https://docs.min.io/docs/minio-gateway-for-azure.html)

## Get Help

[Contact us](https://kitware.github.io/dive/#get-help) for support with any of these topics.
