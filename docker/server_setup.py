import os

import cherrypy
from dive_utils import constants
from girder.exceptions import ValidationException
from girder.models import getDbConnection
from girder.models.assetstore import Assetstore
from girder.models.folder import Folder
from girder.models.setting import Setting
from girder.models.user import User
from pymongo.errors import OperationFailure

cherrypy.config["database"]["uri"] = os.getenv("GIRDER_MONGO_URI")

ADMIN_USER = os.getenv("GIRDER_ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("GIRDER_ADMIN_PASS", "letmein")


def migrate():
    # Migrate foreign media ID from metadata property to inaccessible folder property
    foreign_updates = Folder().update(
        {f'meta.{constants.ForeignMediaIdMarker}': {'$exists': True}},
        {'$rename':{f'meta.{constants.ForeignMediaIdMarker}': constants.ForeignMediaIdMarker}},
    )
    print(f'Migration: Foreign Media Marker: Modified {foreign_updates.modified_count}')

    # Rename annotationItem to trackItem and drop indices
    db = getDbConnection().get_database()
    try:
        db.validate_collection('annotationItem')
        annotationItem = db['annotationItem']
        annotationItem.drop_indexes()
        updated_records = annotationItem.update_many({}, {'$rename': {'trackId': 'id'}})
        annotationItem.rename('trackItem')
        print('Migration: Rename annotationItem to trackItem: done')
        print(f'Migration: Update trackId to id: Modified {updated_records.modified_count}')
    except OperationFailure:
        print('Migration: Rename annotationItem to trackItem: skipped')
    print('Migrations up to date!')


def createInitialUser():
    try:
        User().createUser(
            ADMIN_USER,
            ADMIN_PASS,
            ADMIN_USER,
            ADMIN_USER,
            "admin@admin.com",
            admin=True,
            public=True,
        )
    except ValidationException:
        print("Admin user already exists, skipping...")


def createAssetstore():
    try:
        Assetstore().createFilesystemAssetstore("assetstore", "/home/assetstore")
    except ValidationException:
        print("Assetstore already exists, skipping...")


def configure():
    Setting().set(
        "core.cors.allow_origin",
        os.environ.get(
            "CORS_ALLOWED_ORIGINS", "http://localhost:8080, http://localhost:8010"
        ),
    )


if __name__ == '__main__':
    createInitialUser()
    createAssetstore()
    configure()
    migrate()
