---
hide:
  - navigation
---

# Frequently Asked Questions

## How do I find existing data to use?

The [Training Data Collection](https://viame.kitware.com/#/collection/5e4c256ca0fc86aa03120c34) is organized rougly by domain and collection method.

## How do I share data with others?

This use case is covered [on the sharing page](Web-Version.md#sharing-data-with-teams).

If you want to **publish** your data so that other groups can use it, please email <a href="mailto:viame-web@kitware.com"> `viame-web@kitware.com` </a>.

## How do I run analysis workflows on my data?

In DIVE, these are called pipelines.  You'll need to see what sorts of analysis workflows are currently available [on the pipeline page](Pipeline-Documentation.md).

These sorts of AI workflows are the final goal for most users.  They allow the user to quickly perform quantitative analysis to answer questions like **_how many individuals of each type appear on each image or video frame?_**

If no suitable existing analysis exists for your use case or you aren't sure how to proceed, you're welcome to [email our team and ask for help](index.md#get-help).

## How do I create new models?

You want to perform analysis (detection, tracking, measurement, etc) on object types not yet covered by the community data and pre-trained analysis pipelines available. This will involve training new models based on ground-truth annotations.

Training configurations are listed [on the pipeline page](Pipeline-Documentation.md).

## How can I load data incrementally?

If you have data in lots of places or it arrives at different times, it's probably best to break these batches or groups into individual datasets and annotate each individually.  Using the checkboxes in web, you can use multiple datasets to generate a trained model.

Breaking large amounts of data up into manageable groups is generally a good idea.

## Do users need to transcode their own data?

No. VIAME Web and DIVE Desktop perform automatic transcoding if it is necessary.

## How does video frame alignment work?

When you annotate a video in DIVE, the true video is played in the browser using a native HTML5 video player.

Web browsers report and control time in floating point seconds rather than using frame numbers, but annotations are created using frame numbers as their time indicators, so it's important to make sure these line up.

Most of the time, videos are **downsampled** for annotation, meaning that the true video framerate (30hz, for example) is annotated at a lower rate, such as 5hz or 10hz.  Kwiver (the computer vision tool behind VIAME) uses a downsampling approach that sorts actual frames into downsampled buckets based on the start time of the frame.

An implementation of this approach is described here.

```python
def get_frame_from_timestamp(timestamp, true_fps, downsample_fps):
  downsampled_frame = timestamp * downsample_fps
  real_frame = 

  if downsample_fps >= true_fps:
    # This is a true downsample
    next_true_frame_boundary = Math.ceil(timestamp * true_fps)
    return Math.floor(next_true_frame_boundary / downsample_fps)
  
  raise Exception('Real video framerate must be GTE downsample rate')
```

There are caveats with this approach.

* It does not handle padding properly.  If a video begins or ends with padding, you may see a black screen in DIVE, but kwiver will wait for the first true frame to use as the representative for the bucket.
* It does not handle variable width frames properly.  If a video has variable width frames, the assumptions about the locations of true frame boundaries do not hold and kwiver training may have alignment issues.

## Can I request new features or provide feedback?

Yes!  Please contact us at <a href="mailto:viame-web@kitware.com"> `viame-web@kitware.com` </a> or log an issue [directly on the issue tracker](https://github.com/Kitware/dive/issues).
