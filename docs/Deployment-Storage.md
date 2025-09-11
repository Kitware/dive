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
1. In [storage settings](https://console.cloud.google.com/storage/settings), in the interoperability tab
    1. create an access key (Service account HMAC) for your read-only service account.
    1. set the current project as the default project for interoperability access
    1. take note of your `Access Key`, `Secret Key`, `Storage URI`, and `Bucket Name`.

### Setting up CORS

You'll also need to [configure CORS headers](https://cloud.google.com/storage/docs/configuring-cors) for any buckets where media will be served.

* Save the snippet below as `bucket-cors-config.json`.
* `"origin"` should be whatever you type into your browser to get to the web application.

``` json
  [
    {
      "origin": ["https://viame.kitware.com"],
      "method": ["GET", "PUT", "POST", "DELETE"],
      "responseHeader": ["Content-Type"],
      "maxAgeSeconds": 3600
    }
  ]
```

Then use `gsutils` to configure each bucket.

``` bash
gsutil cors set bucket-cors-config.json gs://BUCKET_NAME
```

### Choose a mount point

Choose a folder as a mount-point inside DIVE Web.  This folder should ideally be dedicated to mapping from your GCS buckets.

We recommend creating a `Google Cloud Storage` folder with sub-folders named for each bucket you mount.  You can do this using the `New Folder` button in DIVE Web's File Browser.  You can get the folder ID from your browser's URL bar.

### Send us the details

If you want to use your bucket with viame.kitware.com, send us an email with the following details to `viame-web@kitware.com`.

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

### S3/MinIO and Annotation Importing

During the importing process annotations that are associated with image-sequences or video files can be automatically imported

* **Video** - For video files the annotation file (CSV or JSON) needs to have the same name as the video with a changed extension. I.E.  video.mp4 will have either video.csv or video.json.  This will automatically import those annotations when the S3/GCP indexing/importing is done
* **Image Sequence** - Image-Sequences should already be in their own folder.  The annotation file (CSV or JSON) needs to just be in the same file.  It shouldn't matter what the name of the file is during importing.

### Pub/Sub notifications

Creating pub/sub notifications is **optional**, but will keep your mount point up-to-date automatically with new data added to the bucket.  In order to make use of this feature, your DIVE server must have a public static IP address or domain name.

1. [Create a bucket notification configuration](https://cloud.google.com/storage/docs/reporting-changes#enabling)
1. [Create a topic subscription](https://cloud.google.com/pubsub/docs/admin#pubsub_create_pull_subscription-console)
1. [Set a push delivery method for the subscription](https://cloud.google.com/pubsub/docs/push)
    1. The URL for delivery should be `https://viame.kitware.com/api/v1/bucket_notifications/gcs`

Our server will process events from this subscription to keep your data current.

### Mirroring setup

If you have your own dive deployment, you can create a bucket mirror yourself through the Girder admin console.

1. Open `/girder#assetstores` in your browser.
    1. Choose ==:material-cloud-upload: Create new Amazon S3 Assetstore==
    1. Enter a name and all the details you collected above.
    1. For **region**, enter the AWS or GCS region you're using, like `us-east-1`.
    1. For **service**, enter the service URI if you're using an S3 provider other than AWS (such as MinIO or GCS).
    1. Mark as **Read only**.
1. Now import your data.  Choose the green ==Begin Import=={ .success } button on the new assetstore.
    1. Leave **Import path** blank unless you only want to import part of a bucket.
    1. For **Destination type**, use the folder ID you chose as the mount point above.

The import may take several minutes.  You should begin to see datasets appear inside the mount point folder you chose.
