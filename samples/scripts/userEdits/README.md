# DIVE Track Authors

`trackAuthors.py` lists the current version of each track in a dataset (`trackItem`) along with the user who last saved it and its `rev_created` (from `revisionLogItem`). Pass `--all-versions` to include every replaced or deleted version as well. For image-sequence datasets it also maps frame numbers to image names, using the same ordering as the server.

Each track version is joined to the revision log through `rev_created`. A save writes out the whole track again, so authorship is per track version, not per detection.

The revision `description` shows where a version came from:

| description | Source |
|-------------|--------|
| `save` | Manual edit in the DIVE annotator |
| `Import <type> from <file>` | Uploaded annotation file or pipeline output |
| `initialize clone` | Dataset clone (earlier history lives on the source dataset) |

## Prefer the HTTP API when you can

For normal scripting against a running DIVE server, use
[`GET dive_annotation/track/authors`](../../../docs/scripting/Endpoints.md)
with a Girder token. That endpoint respects dataset ACLs, returns the author of
each visible track at a revision, and does not need Mongo access.

Use this script only for ops/admin work that needs Mongo-only options the API
does not expose (`--all-versions`, `--features`, image-name mapping, full
revision log dump). It talks to Mongo directly and **bypasses Girder access
control**, so anyone with the URI can read every dataset.

## Requirements

- [uv](https://docs.astral.sh/uv/) (installs `click` and `pymongo` automatically)
- Network access to the Girder MongoDB

The default `docker-compose.yml` does not publish the Mongo port, so `localhost:27017` is refused. Either pass `--container dive-mongo-1` (the script looks up the container IP with `docker inspect`), pass `--mongo-uri` with that IP, or add `ports: ["27017:27017"]` to the `mongo` service in an override file.

## Usage

From the repository root:

```bash
# Current version of each track, with its author, rev_created and begin/end image names
uv run samples/scripts/userEdits/trackAuthors.py <folderId> --container dive-mongo-1

# Full history (every saved version), each feature's frame and image name, and the revision log
uv run samples/scripts/userEdits/trackAuthors.py <folderId> --all-versions --features --revisions

# A different Mongo host, a named annotation set, output to a file
uv run samples/scripts/userEdits/trackAuthors.py <folderId> \
  --mongo-uri mongodb://172.18.0.6:27017/girder --set mySet -o tracks.json
```

HTTP equivalent (token-authenticated, ACL-aware):

```bash
curl -H "Girder-Token: $TOKEN" \
  "$GIRDER/api/v1/dive_annotation/track/authors?folderId=<folderId>"
```

## Output

```json
{
  "datasetId": "...",
  "name": "...",
  "type": "image-sequence",
  "imageCount": 326,
  "tracks": [
    {
      "id": 0,
      "begin": 238,
      "end": 238,
      "beginImage": "20171027.214850.033.029373.png",
      "endImage": "20171027.214850.033.029373.png",
      "featureCount": 1,
      "types": ["Motion"],
      "rev_created": 10,
      "rev_deleted": null,
      "author_name": "jdoe",
      "author_id": "...",
      "created": "...",
      "description": "save"
    }
  ]
}
```

Track fields use the same names as `GET dive_annotation/track/authors` (`id`, `begin`, `end`, `featureCount`, `rev_created`, `author_id`, `author_name`, `created`, `description`), so output built on this script keeps working if you switch to the API. `beginImage`, `endImage`, `types`, `rev_deleted` and `features` are script-only extras.

`rev_deleted` is always `null` by default; with `--all-versions` it is the revision that replaced or deleted that version. Image names are `null` for video datasets. Pass `--revisions` to add a `revisions` array with the dataset's full revision log (author, time, description, additions, deletions).
