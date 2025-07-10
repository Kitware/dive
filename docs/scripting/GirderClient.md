# Girder Client

Girder Client is a python client library that makes it eaiser to work with Girder/DIVE endpoints.

[Girder Client Documentation](https://girder.readthedocs.io/en/latest/python-client.html#the-python-client-library)

## Initialization

```
apiURL = "viame.kitware.com" # can also use localhost for local development
port = 443 # 8010 for local development
def login():
    gc = girder_client.GirderClient(apiURL, port=port, apiRoot="girder/api/v1")
    gc.authenticate(interactive=True)
    return gc
```

This code snippet creates a login context for girder-client.  By interactively in the python script asking for the username and password.  If you want to utilize an apiKey you can use the following instead of `interactive=True` asking for the username/password:

```
gc.authenticate(apiKey=apiKeyVar)
```

The apiKey can be accessed by going to the girder-endpoint `/token/current` if you are logged into the system.  I.E for viame.kitware.com this would be [viame.kitare.com/api/v1/token/current](https://viame.kitware.com/api/v1#/token/token_currentSession_current)

## Common Girder Client Functions

### [girder_client.get(path, parameters=None, jsonResp=True)](https://girder.readthedocs.io/en/latest/python-client.html#girder_client.GirderClient.get)

Function used to send a simplified GET request to a specific endpoint path like `/dive_dataset`.
The paramemters can be entered as a dictionary of values
The jsonResp defaults to true.  If an endpoint returns binary data or data that is not JSON set jsonResp to False.


### [girder_client.sendRestRequest(method, path, parameters=None, data=None, files=None, json=None, headers=None, jsonResp=True)](https://girder.readthedocs.io/en/latest/python-client.html#girder_client.GirderClient.sendRestRequest)

Sends a specific Method: (GET, PATCH, DELETE, POST...) to the path with the parameters and possible files.  This allows for more fine grained control of the REST request send to the endpoint 

### [girder_client.listFolder(parentId, parentFolderType='folder', name=None, limit=None, offset=None)](https://girder.readthedocs.io/en/latest/python-client.html#girder_client.GirderClient.listFolder)

Given a parentId folder this will list all of the folders based on the other filter parameters.  This is useful to list subfolders within a parent folder.

### [girder_client.addMetadataToFolder(folderId, metadata)](https://girder.readthedocs.io/en/latest/python-client.html#girder_client.GirderClient.addMetadataToFolder)

Allows adding metadata to a specific folder.  This can be usefule to change attributes specifications for a folder or mark a folder as 'annotate=True' to indicate that it is a DIVE Dataset folder.


### [girder_client.uploadFileToFolder(folderId, filepath, reference=None, mimeType=None, filename=None, progressCallback=None)](https://girder.readthedocs.io/en/latest/python-client.html#girder_client.GirderClient.uploadFileToFolder)

Uploads a specific filder to a parent folder.  This would probably be used in conjunction with girder_client.sendRestRequest('POST', 'dive_rpc/postprocess/{id}', parameters= {'skipJobs': True, 'skipTranscoding': True}) where the Id is the folderId.  This way you can upload a CSV/JSON annotation file to a folder then call postprocess to process that data

