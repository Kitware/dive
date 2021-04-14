# Jupyter Notebooks

Helpful notebooks for users and admins to do analysis and data management using the DIVE Web REST API.

## Setup

Easiest to run with VS Code's Jupyter Notebook plugin.

These notebooks require the local packages and dependencies.

```bash
cd ../ # run from project root
pip3 install -e server/
pip3 install -r server/dev-requirements.txt
```

Get an api key from [viame.kitware.com/girder](https://viame.kitware.com/girder):

* Click the user dropdown (top right corner) and select "My Account"
* Choose the "API Keys" tab
* Create a new key with whatever access level you need, probably only "Read Data".

Set up a `.env` file with credentials retrieved from viame.kitware.com.  You could also paste your key directly into the notebook.

``` bash
# From this directory
cp .env.default .env

# Edit the new file with your api key.
```
