import json
import os

import click
import girder_client

"""
This script is used to sync a folder Hierarchy of Annotation files with a similar folder structure within Girder

Arguments: 
- folder: local Folder Location
- girder_id: girderId for matching folder on the server

Process:

1.  The system will look through the current folder for CSV files.  It is specifically looking for files with
The format of /folder/folder/{keyFolderName}/{label}/{keyFilename}Dataset.csv where the keyFolderName and keyFilename are specified below in the main settings

2. It retrieves the full base Path to the currently indicated girder_id specified in the arguments.

3. The script attempts to find the matching dataset within the girder_id folder by removing the keyFolderName and keyFilename

4. After finding the dataset it returns back an object with the label for the annotations, the girder parent folderId and the filename for the CSV files

5. Now options are presented to the user, they can either upload the annotations to the source directory or they can create a folder in their User/Public
directory with a custom name and clone the datasets to add annotations to.

6. Once the decisions to either create a User/Public folder or upload to the dataset source locations is made the system will then upload the annotations.

7. This is where the 'default_label' option is used.  If the the folder under Annotations doesn't match the 'default_label' when uploading to the source images
it will create a clone with the name {Dataset} - {label}.  This allows multiple folders to be used to upload different annotations to the system.
"""


apiURL = "localhost"
port = 8010
baseGirderId = ""  # Sample folder
baseGirderType = "folder"  # folder | collection | user
keyFolderName = "ANNOTATIONS"  # The folder name under which to look for Annotations
keyFileName = "annotations-"  # a key for replacement on the annotation-file to sync it with the dataset
limit = 10  # for testing purposes kkeep lower then increase
default_label = "unlabeled"  # when uploading this will be the folder that will replace the existing annotations.
# all other labels will create a clone with the name of the dataset and the label type.


# Login to the girder client, interactive means it will prompt for username and password
def login():
    gc = girder_client.GirderClient(apiURL, port=port, apiRoot="girder/api/v1")
    gc.authenticate(interactive=True)
    return gc


# Simple search within folder to get annotation files and their paths
def get_annotations(folder):
    checkFolder = folder
    foundfiles = []
    for root, dirs, files in os.walk(checkFolder):
        for file in files:
            if file.endswith(".csv"):
                # base name exists we can get a list of files
                foundfiles.append(os.path.join(root, file))
    return foundfiles


# returns the girder base path for the indexed folder
def getBasePath(gc: girder_client.GirderClient, folder: str, type: str):
    return gc.sendRestRequest("GET", f"resource/{folder}/path?type={type}")


# attempts to find the filename dataset and the 'Video {filename}'
def find_dataset(gc: girder_client.GirderClient, filename: str, baseGirderPath: str):
    basename = os.path.basename(filename)
    # first we need to remove the ANNOTATIONS/{labeled}/annotations from the filename
    print(filename)
    start_index = filename.find(keyFolderName)
    end_index = filename.find(keyFileName) + len(keyFileName)
    removed_label = filename[start_index:end_index].split("/")[1]
    removed_data = filename[end_index:]
    check_path = removed_data.replace(".csv", "")
    check_path = check_path.replace(basename, f"Video {basename}")
    # Check for a Video
    found = gc.sendRestRequest(
        "GET",
        "resource/lookup",
        parameters={"path": f'/{baseGirderPath}/{check_path.replace(".csv", ".mp4")}'},
    )
    if found:
        if found.get("meta", {}).get("annotate", False):
            return {
                "id": found.get("_id", False),
                "label": removed_label,
                "parentId": found.get("parentId", False),
            }
    # secondary check on the root name with out "Video "
    check_path = check_path.replace(f"Video ", "")
    found = gc.sendRestRequest(
        "GET",
        "resource/lookup",
        parameters={"path": f"/{baseGirderPath}/{check_path}"},
    )
    if found:
        if found.get("meta", {}).get("annotate", False):
            return {
                "id": found.get("_id", False),
                "label": removed_label,
                "parentId": found.get("parentId", False),
            }
    # check for Image Directory
    check_path = check_path.replace(".mp4", "")
    found = gc.sendRestRequest(
        "GET",
        f"resource/lookup",
        parameters={"path": f"/{baseGirderPath}/{check_path}"},
    )
    if found:
        if found.get("meta", {}).get("annotate", False):
            return {
                "id": found.get("_id", False),
                "label": removed_label,
                "parentId": found.get("parentId", False),
            }
    return False


# Uploads annotations in place back into the source imagery/video directories on Girder
def upload_inplace_annotations(gc: girder_client.GirderClient, annotations):
    for annotation in annotations:
        print(annotation)
        upload_folder = annotation["girderId"]
        upload_file = annotation["file"]
        if (
            annotation["label"] != default_label
        ):  # now we clone based on non-default label
            parent_folder = annotation["parentId"]
            name = f"{os.path.basename(annotation['file']).replace(keyFileName, '').replace('.csv','')} - {annotation['label']}"
            # Lets check if the folder already exists
            folder_list = gc.sendRestRequest(
                "GET",
                f"folder?parentType=folder&parentId={parent_folder}&limit=99999&sort=lowerName&sortdir=1",
            )
            name_map = {}
            for item in folder_list:
                name_map[item["name"]] = item["_id"]
            if name in name_map.keys():
                upload_folder = name_map[name]
            else:
                new_folder = gc.sendRestRequest(
                    "POST",
                    f'dive_dataset?cloneId={annotation["girderId"]}&parentFolderId={parent_folder}&name={name}',
                )
                upload_folder = str(new_folder["_id"])

        # Now we upload the file and trigger a post process to view the data
        gc.uploadFileToFolder(upload_folder, upload_file)
        gc.sendRestRequest(
            "POST",
            f"dive_rpc/postprocess/{upload_folder}",
            data={"skipTranscoding": True, "skipJobs": True},
        )


# uploads annotations to a user public folder
def clone_and_upload_annotations(
    gc: girder_client.GirderClient, annotations, rootFolder
):
    for annotation in annotations:
        upload_folder = annotation["girderId"]
        upload_file = annotation["file"]
        name = f"{os.path.basename(annotation['file']).replace('.csv','')}"
        if annotation["label"] != default_label:  # now we change the name
            name = f"{name} - {annotation['label']}"
        new_folder = gc.sendRestRequest(
            "POST",
            f'dive_dataset?cloneId={annotation["girderId"]}&parentFolderId={rootFolder}&name={name}',
        )
        upload_folder = str(new_folder["_id"])
        gc.uploadFileToFolder(upload_folder, upload_file)
        gc.sendRestRequest(
            "POST",
            f"dive_rpc/postprocess/{upload_folder}",
            data={"skipTranscoding": True, "skipJobs": True},
        )


# returns the public folder of the user who logged in
def get_public_folder(gc: girder_client.GirderClient):
    current_user = gc.sendRestRequest("GET", "user/me")
    userId = current_user["_id"]
    folders = gc.sendRestRequest(
        "GET",
        f"folder?parentType=user&parentId={userId}&text=Public&limit=50&sort=lowerName&sortdir=1",
    )
    if len(folders) > 0:
        uploadFolder = folders[0]["_id"]
    else:
        print("No folder found for the user")
    return uploadFolder


def ask_question(prompt):
    while True:
        response = input(prompt).strip().lower()
        return response


def ask_yes_no_question(prompt):
    while True:
        response = input(prompt).strip().lower()
        if response == "y":
            return True
        elif response == "n":
            return False
        else:
            print("Invalid input. Please enter 'y' or 'n'.")


@click.command(name="LoadData", help="Load in ")
@click.argument(
    "folder"
)  # a local folder to search for mp4 video files and json/csv files.
@click.argument("girder_id", required=False)
def load_data(folder, girder_id):
    baseGirderId = girder_id
    annotations = get_annotations(folder)
    print(annotations)
    gc = login()
    base_path = getBasePath(gc, baseGirderId, baseGirderType)
    print(base_path)
    upload_list = []
    for annotation in annotations:
        print(annotation)
        result = find_dataset(gc, annotation, base_path)
        if result:
            upload_list.append(
                {
                    "girderId": result["id"],
                    "label": result["label"],
                    "parentId": result["parentId"],
                    "file": annotation,
                    "type": "upload",
                }
            )
    local_public = ask_yes_no_question(
        f'Would you like to create a cloned copy of the images in your public folder?  If you choose "n" it will upload the annotations to the source image locations. (y/n)\n'
    )
    if local_public:
        folder_name = None
        while not folder_name:
            folder_name = ask_question(
                "What is the root folder that should be created in your Public folder?"
            )
        public_folder = get_public_folder(gc)
        base_folder = gc.createFolder(
            parentId=public_folder, name=folder_name, reuseExisting=True
        )
        clone_and_upload_annotations(gc, upload_list, str(base_folder["_id"]))
    else:
        upload_inplace_annotations(gc, upload_list)


if __name__ == "__main__":
    load_data()
