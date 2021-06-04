# DIVE Desktop

DIVE is available as an electron based desktop application with deep [VIAME](https://github.com/viame/viame) integration.

DIVE Desktop has most of the same UI and features as DIVE **without** requiring a network connection or a server installation.

![images/Banner.png](images/Banner.png)

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

## Video Transcoding

DIVE Desktop is an [Electron](https://www.electronjs.org/) application built on web technologies.  Certain video codecs require automatic transcoding to be usable.  Video will be transcoded unless _all_ the following conditions are met.

* `codec` = `h264`
* `sample_aspect_ratio (SAR)` = `1:1`

## Configuration

DIVE Desktop requires a local installation of the VIAME toolkit to run pipelines, train, and do transcoding.

![Desktop Settings](images/General/desktop-settings.png)

* `VIAME Install Path` is set automatically if you use `examples/annotation_and_visualization/launch_dive_interface` from the VIAME install.  Otherwise, you may need to set this yourself.  Use `Choose` to choose the base installation path, then click save.
* `Project Data Storage Path` defaults to a subfolder in your user workspace and should generally not be changed.

### Configuration with env

DIVE Desktop looks for the these environment variables on launch.

| Name | Default | Description |
| ---- | ------- | ----------- |
| DIVE_VIAME_INSTALL_PATH | /opt/noaa/viame (linux/macos) C:\Program Files\VIAME (windows) | location of VIAME installation.  Users may override this value in the settings pane |

## Troubleshooting

If you're experience problems or have questions about DIVE Desktop, [contact us](index.md#get-help) and include the content from the settings page such as `Build Version` as well as your currently installed VIAME version.
