# Google Cloud

This guide is intended for DIVE Web users who would like to use Google Cloud features like storage and compute to store and process data.  Your data will live in GCS Buckets and can be analyzed on either Kitware's servers or your own service workers.

## Google Cloud Storage Mirroring

DIVE Web can mirror your data from google cloud storage buckets such that your team fully controls upload and data organization, but is able to view, annotation, and run analysis on that data in the DIVE platform.

### Creating access credentials

1. Create a new [service account](https://cloud.google.com/iam/docs/creating-managing-service-accounts) with read-only access to the bucket(s) and path(s) that you want to map.
1. In [storage settings](https://console.cloud.google.com/storage/settings) create an access key for your read-only service account.
1. Send the new credentials to the DIVE team by emailing `viame-web@kitware.com`.  Include a list of bucket names and prefix paths that these credentials are provisioned for.

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

### Mirroring existing data

Choose a folder as a mount-point inside DIVE Web.  This folder should ideally be dedicated to mapping from your GCS buckets.

We recommend creating a `Google Cloud Storage` folder with subfolers named for each bucket in your user's workspace.  You can do this using the `New Folder` button in DIVE Web's File Browser.
