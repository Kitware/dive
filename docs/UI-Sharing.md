# Sharing and Permissions Management

This information will be relevant to teams where several people need to work on the same data.

## Concepts

By default, data updloaded to your personal user space follows these conventions.

* Data in the `Public` folder is readable by all registered users, but writable only by you by default.
* Data in the `Private` folder is only visible to you by default.

!!! info
    You can share your entire public or private folder with team members.

## Working with teams

A common scenario is for a group to have a lot of shared data that several members should be able to view and annotate.

For most teams, we recommend keeping data consolidated under a single account then following the sharing instructions below to make sure all team members have appropriate access.

It's easiest to create a single parent directory to share and then put all individual datasets inside that parent.

!!! warning
    You should note that 2 people **cannot** work on the same video at the same time.  Your team should coordianate on who will work on each dataset.

## Managing Permissions

DIVE uses Girder's [Permissions Model](https://girder.readthedocs.io/en/latest/user-guide.html#permissions).

There are four levels of permission a User can have on a resource.

* No permission (cannot view, edit, or delete a resource)
* READ permission (can view and download resources)
* WRITE permission (includes READ permission, can edit the properties of a resource)
* ADMIN also known as own permission, (includes READ and WRITE permission, can delete the resource and also control access on it)

### To allow other users to edit or run jobs on your datasets:

* Navigate to your data in the data browser.
* Right click a dataset folder or directory to share.

![Right Click Menu](images/Sharing/RightClickMenu.png)

* Search for and select users you want to grant permissions for.
* Select the correct permissions in the drop-down next to each user.

![Search For Users](images/Sharing/SearchBar.png)

* **Be sure to enable `Include subfolders` at the bottom of the dialog.**

![Toggle Include Subfolders](images/Sharing/Toggles.png)

* Click save.

These users should now be able to view and edit your data.

## Sharing URLs

You can copy and paste any URL from the address bar and share with collaborators.  This includes folders in the data browser as well as direct links to the annotation editor.
