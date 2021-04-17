# Google Cloud

This guide is intended for DIVE Web users who would like to use Google Cloud resources like storage and compute to store and process data.  Your data will live in GCS Buckets and can be analyzed on either Kitware's servers or your own service workers.

![Google Cloud Diagram](images/Diagrams/Google-Cloud.png)

## Concepts

* Kitware maintains viame.kitware.com web server deployment.
* You own and manage your data in cloud storage buckets.
* (optional) You run worker nodes that process your own job queue.

There are several benefits to this configuration:

* Our team can provide support and troubleshooting directly on your data and error logs.
* Our team manages deployments, updates, and maintenance.
* Our team can provide recommendatations for annotation and analysis based on your specific data and needs.

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

## Google Cloud GPU Workers

Run a GPU worker in Google Cloud (or anywhere you have GPU resources) to process your queue from viame.kitware.com.
