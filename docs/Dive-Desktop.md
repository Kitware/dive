# DIVE Desktop

DIVE is available as an electron based desktop application with deep [VIAME](https://github.com/viame/viame) integration.

DIVE Desktop has most of the same UI and features as DIVE **without** requiring a network connection or a server installation.

## Installation

[⬇️ Download the latest DIVE Desktop from GitHub](https://github.com/Kitware/dive/releases/latest){ .md-button .md-button--primary }

Choose an **asset** from the list matching your operating system:

| OS       | Extension | Description |
| -------- | --------- | ----------- |
| Windows  | .exe      | Portable executable (recommended) |
| Windows  | .msi      | Installer file |
| MacOS    | .dmg      | MacOS DiskImage (Intel only, M1 not supported) |
| Linux    | .AppImage | Portable executable for all Linux platforms (recommended) |
| Linux    | .snap     | Ubuntu SnapCraft package |

### Full VIAME Desktop Installation

This is just the installation guide for DIVE.  If you want the full VIAME tool suite, you can get it from [github.com/viame/viame](https://github.com/viame/viame#installations)

## Features

Full Windows and Linux support.  Annotation support for MacOS.

* Annotate video and images on your computer (Instead of uploading to a server)
* Run pipelines and training on multiple datasets using locally installed VIAME

![images/Banner.png](images/Banner.png)

## Importing Images & Videos

* For video, DIVE will ask you to point directly to a file.
* For images, DIVE Desktop imports **entire directories**.  That means all images from a single folder will be imported as a dataset.  You can use globbing to filter the contents of an image directory during import.

**Annotation Files** - In either case, either a `*.csv` or a `result*.json` annotaton file should be located in the same directory as the source media, and will be automatically discovered during import.  Annotation files are not required.

## Video Transcoding

DIVE Desktop is an [Electron](https://www.electronjs.org/) application built on web technologies.  Certain video codecs require automatic transcoding to be usable.  Video will be transcoded unless _all_ the following conditions are met.

* `codec` = `h264`
* `sample_aspect_ratio (SAR)` = `1:1`

## Configuration

DIVE Desktop requires a local installation of the VIAME toolkit to run pipelines, train, and do transcoding.

![Desktop Settings](images/General/desktop-settings.png)

* `VIAME Install Path` is set automatically if you use `examples/annotation_and_visualization/launch_dive_interface` from the VIAME install.  Otherwise, you may need to set this yourself.  Use `Choose` to choose the base installation path, then click save.
* `Project Data Storage Path` defaults to a subfolder in your user workspace and should generally not be changed.
* `Read only mode` disables the ability to save when using the annotator.

### Data Storage Path

The data storage path is not at all related to "project folders" in VIAME.  It's just a place for DIVE Desktop to keep and structure all the data it needs to run.

A typical data storage directory has 3 subfolders:

* `DIVE_Jobs` - Each job run has a working directory, kept here.
* `DIVE_Projects` - Each dataset you import into desktop has metadata and annotation data (with revision history) kept here.
* `DIVE_Pipelines` - Training runs produce models that get copied into here.

Here's an example of structure you might find in the storage path.

``` text
VIAME_DATA
├── DIVE_Jobs
│  ├── Scallop_1_scallop and flatfish_06-01-2021_11-02-11.585
│  │  ├── detector_output.csv
│  │  ├── dive_job_manifest.json
│  │  ├── image-manifest.txt
│  │  └── runlog.txt
│  └── Scallop_2_scallop netharn_06-01-2021_11-02-19.432
│     ├── detector_output.csv
│     ├── dive_job_manifest.json
│     ├── image-manifest.txt
│     └── runlog.txt
├── DIVE_Pipelines
│  ├── My Fish SVM Demo
│  │  ├── detector.pipe
│  │  └── fish.svm
│  └── Quadcam_Fish_Detector_SVM
│     ├── detector.pipe
│     └── fish.svm
└── DIVE_Projects
   ├── fish_training_data_c_jp7hq88vfv
   │  ├── auxiliary
   │  │  └── result_06-01-2021_10-55-38.627.json
   │  ├── meta.json
   │  └── result_06-01-2021_04-53-38.050.json
   └── scallop_2_jrgdq760gu
      ├── auxiliary
      │  └── result_06-01-2021_10-54-56.034.json
      ├── meta.json
      └── result_06-01-2021_11-02-35.857.json
```

### Configuration with env

DIVE Desktop looks for the these environment variables on launch.

| Name | Default | Description |
| ---- | ------- | ----------- |
| DIVE_VIAME_INSTALL_PATH | /opt/noaa/viame (Linux/macOS) C:\Program Files\VIAME (Windows) | Overrides the location of the VIAME installation.  Users may not change this value in the settings pane if provided. |
| DIVE_READONLY_MODE | None | Overrides read only mode to true or false.  Users may still change this value in the settings pane if provided. |

## Import/Export of Models

Trained models are kept in `${Project Data Storage Path}/DIVE_Pipelines` as described above.  Each model file consists of exactly 1 pipe file and some number of other model files.

* The pipe file can be one of `detector.pipe`, `tracker.pipe`, or `generate.pipe`.
* Other files can be `.zip`, `.svm`, `.lbl`, or `.cfg`.

You can use exteranally trained models in DIVE by creating a folder containing these files.  The name of the configuration or pipeline in dive will be the folder name you create.

## Troubleshooting

> I imported some data, but I don't see my annotations

See [Importing images and video above](#importing-images-videos).

> ffmpeg not installed, please download and install VIAME Toolkit from the main page

DIVE Desktop relies on an installation of `ffmpeg` for transcoding videos and some images.  This tool comes with the VIAME installation.  Verify your VIAME Install Base Path is correct.

> Some VIAME canned pipelines are missing?

If you don't see some pipelines you expect, you may not have installed the addons (also called Optional Patches) yet.  Download and install these based on the [VIAME installation docs](https://github.com/viame/VIAME#installations).  

> Advanced troubleshooting

If you're experience problems or have questions about DIVE Desktop, [contact us](index.md#get-help) and include the content from the settings page such as `Build Version` as well as your currently installed VIAME version.

To help us address errors and exceptions, it's helpful to look in the debug console.  Press `CTRL + SHIFT + i` to launch the Dev Tools and look under the console tab.  Errors and warnings will appear in red and yellow.  You can right-click in the console area and click "Save As" to save the log file to email to us.

![Debugging Desktop](images/General/desktop-debug.png)
