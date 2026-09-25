# Importing object types

In the annotation viewer, open **Type Settings** (the gear in the types list),
then **Types**. Choose a `.txt`, `.csv`, or `.json` file, review the type and parent
relationship preview, and click **Add**. This works in both DIVE desktop and web,
including the sidebar and bottom panel layouts. You can also paste one type per
line. Imported types are shown even without annotations. Save the dataset to persist
the imported definitions.

Imports add to the dataset's existing types and hierarchy. They do not import or
modify annotations, delete existing types, or replace existing parents. Invalid
files, cycles, and conflicting parents leave the dataset unchanged. DIVE supports
one parent per type; multiple distinct parents are rejected.

## COCO and VIAME JSON

A full COCO file can be selected; only its `categories` are read. Category names
come from `name`, and a nonempty `supercategory` specifies the parent. A `parents`
array is used when there is no nonempty `supercategory`. A COCO `supercategory`
identical to the category name is treated as a top-level category.

```json
{
  "categories": [
    { "id": 1, "name": "fish", "supercategory": "animal" },
    { "id": 2, "name": "salmon", "parents": ["fish"] }
  ]
}
```

JSON may also be an array of names (`["fish", "shark"]`), an array of category
objects, or an object with a `typeHierarchy` child-to-parent map. The map can
accompany `categories` or appear alone:

```json
{ "typeHierarchy": { "salmon": "fish", "fish": "animal" } }
```

Parents need not have their own category records. DIVE shows them as hierarchy
headings. COCO images, annotations, IDs, and keypoint definitions are not imported
by this dialog.

## VIAME TXT and CSV

These formats follow VIAME's training label syntax: each row declares a canonical
category followed by optional synonyms and `:parent=` fields. Extra fields are
synonyms, not additional categories. TXT fields are separated by whitespace;
quote names containing spaces. TXT also supports `#` comments.

```text
# Canonical category, optional synonyms, optional parent
animal
"sea life" marine :parent=animal
salmon :parent="sea life"
```

CSV uses commas between fields, with standard double quoting for embedded commas,
quotes, or newlines. No header row is required or interpreted.

```csv
animal
sea life,marine,:parent=animal
salmon,, :parent=sea life
"fish, red",redfish,:parent=marine
```

Synonyms (including JSON `synonyms` arrays) are used to resolve parent references
to canonical names during import. DIVE does not store synonym aliases; the preview
shows a warning when the file contains them. UTF-8 files with or without a BOM,
Windows line endings, and uppercase filename extensions are supported.

## Importing directly from WoRMS

In **Type Settings → Types**, choose the **WoRMS** tab. Enter at least two
characters of a scientific name and click **Search**. You can search for a species,
genus, family, or another taxonomic rank. Search results include the rank,
authority, acceptance status, and a link to the corresponding WoRMS record.

Select individual taxa or use **Select page**. Results are shown in pages of up to
50 records; selections are retained when changing pages or searches. **Browse
children** lists a taxon's immediate children, and **Back** returns to its parent
or the original search. This does not automatically download all descendants.

**Include taxonomic parent categories** is enabled by default. Click **Add** to
resolve selected synonyms to accepted scientific names and
retrieve the parent chains. This returns to **File or pasted list**, combining the
WoRMS selection with any pending categories there. Review the staged types and
parent → child relationships, then click **Add** again to apply them to the dataset.
The first Add never modifies the dataset. Uncheck the parent option to import
only the selected accepted
names. Existing annotations are unchanged; existing hierarchy conflicts must be
resolved before adding the import.

WoRMS lookup requires internet access in both web and desktop. Requests have a
20-second timeout and can be cancelled. An unsuccessful or cancelled preparation
does not import a partial list. Imported types remain available offline once the
dataset is saved; they are not automatically renamed when WoRMS changes.

Dataset configuration stores the imported WoRMS AphiaIDs, original scientific
names, and ranks in `taxonomySources`, keyed by AphiaID. Parent taxa are included
when their hierarchy is imported. These records document the import source and
are retained even if a type is subsequently renamed or removed. A record can be
looked up at `https://www.marinespecies.org/aphia.php?p=taxdetails&id=APHIA_ID`.

Data are supplied by the [World Register of Marine Species](https://www.marinespecies.org/)
using its [REST webservice](https://www.marinespecies.org/rest/). Search is limited
to marine taxa. DIVE makes bounded, user-driven requests; it does not harvest the
whole registry. For a complete registry snapshot, WoRMS provides a separate
[database request process](https://www.marinespecies.org/aphia.php?p=webservice).
