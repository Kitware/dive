# Cloud Storage Integration

This page is intended for storage administrators who would like to make their existing data available through VIAME Web.

!!! tip

    This guide assumes you are working with [viame.kitware.com](https://viame.kitware.com).  If you are using a different deployment, be sure to change the appropriate fields.

!!! tip

    Regarding data transfer costs, if you choose to keep both your data storage and job runners in Google Cloud (or AWS), you will avoid paying a data egress fee for transferring data between storage and the processing node.

## Google Cloud Storage Mirroring

DIVE Web can mirror your data from Google Cloud storage buckets such that your team fully controls upload and data organization, but is able to view, annotate, and run analysis within VIAME Web.

### Creating access credentials

1. Create a new [service account](https://cloud.google.com/iam/docs/creating-managing-service-accounts) with read-only access to the bucket(s) and prefixes that you want to map.
1. In [storage settings](https://console.cloud.google.com/storage/settings), in the interoperability tab, create an access key (Service account HMAC) for your read-only service account.

### Setting up CORS

You'll also need to [configure CORS headers](https://cloud.google.com/storage/docs/configuring-cors) for any buckets where media will be served.

Save the following snippet as `bucket-cors-config.json` .

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

We recommend creating a `Google Cloud Storage` folder with subfolders named for each bucket in your user's workspace.  You can do this using the `New Folder` button in DIVE Web's File Browser.  You can get the folder ID from the browser's URL bar.

### Send us the details

Send an email with the following details from above to `viame-web@kitware.com`.

``` text
subject: Add a google cloud storage bucket mount

Bucket name:
Service provider: Google cloud
Access Key: 
Secret Key:
Mount point folder:
Prefix (if applicable):
```

## S3 and MinIO Mirroring

If you have data in S3 or MinIO, you can mirror it in DIVE for annotation.

* Data is expected to be either videos or images organized into folders
* You should not make changes to folder contents once a folder has been mirrored into DIVE.  Adding or removing images in a particular folder may cause annotation alignment issues.
* Adding entire new folders is supported, and will require a re-index of your S3 bucket.

### Mirroring setup

To create a bucket mirror on your own DIVE deployment.

1. Open `/girder#assetstores` and create a new S3 assetstore.  Mark as **Read only**.
1. Choose the green "Begin Import" button on the new assetstore.
1. Choose a prefix within your bucket to mirror (probably just `/`) and a destination folder ID.  You can get the destination folder ID from the URL of the folder location in your address bar.
