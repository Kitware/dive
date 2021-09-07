# Deployment Overview

The deployment documentation in this guide will discuss the following options.

1. Using our deployment of VIAME Web at [viame.kitware.com](https://viame.kitware.com)
1. Running your own standalone instance of VIAME Web on either a local server or a cloud virtual machine.
1. Running VIAME pipelines or training from the command line using project folders in a cloud environment.
1. Hybrid options for using local or cloud compute resources together with [viame.kitware.com](https://viame.kitware.com).
1. Hybrid options for integrating data from cloud storage such as GCP Buckets or S3 into a VIAME Web deployment.

#### Comparing options

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

You may wish to run your own deployment of VIAME Web in your own lab or in a cloud environment.  Deploying VIAME Web is relatively straighforward with `docker-compose`.

#### Bare Metal

If you have a physical server and SSH access to a user with `sudo` permissions, you can get started with the [docker documentation available on github](https://github.com/Kitware/dive/tree/main/docker).

#### Google Cloud

You'll need to provision a GCP Virtual Machine (VM).

#### AWS

You'll need to provision an EC2 instance using the command line or AWS console.  You can either run the whole stack on a single node or rely on AWS infrastructure like Amazon MQ, MongoDB Atlas, and ELBs.  There is likely no one-size-fits-all cloud deployment architecture, so feel free to contact us to discuss your needs.

## [Hybrid Options for Compute](Deployment-Hybrid-Google-Cloud.md).
