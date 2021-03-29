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


## Features

Full Windows and Linux support.  Annotation support for MacOS.

* Annotate video and images on your computer (Instead of uploading to a server)
* Run pipelines and training on multiple datasets using locally installed VIAME

## Usage

DIVE Desktop generally requires a local installtion of the VIAME toolkit to be fully functional.  It works on its own as a media annotator, but requires VIAME to perform analysis pipelines and model training.

| Name | Default | Description |
| ---- | ------- | ----------- |
| DIVE_VIAME_INSTALL_PATH | /opt/noaa/viame (linux/macos) C:\Program Files\VIAME (windows) | location of VIAME installtion.  Users may override this value in the settings pane |

![images/Banner.png](images/Banner.png)
