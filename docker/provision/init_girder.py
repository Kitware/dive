import os
import cherrypy
from girder.models.assetstore import Assetstore
from girder.models.setting import Setting
from girder.models.user import User
from girder.exceptions import ValidationException

cherrypy.config["database"]["uri"] = os.getenv("GIRDER_MONGO_URI")


ADMIN_USER = os.getenv("GIRDER_ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("GIRDER_ADMIN_PASS", "letmein")


def createInitialUser():
    try:
        User().createUser(
            ADMIN_USER, ADMIN_PASS, ADMIN_USER, ADMIN_USER, "admin@admin.com", admin=True, public=True,
        )
    except ValidationException:
        print("Admin user already exists, skipping...")


def createAssetstore():
    try:
        Assetstore().createFilesystemAssetstore("assetstore", "/home/assetstore")
    except ValidationException:
        print("Assetstore already exists, skipping...")


def configure():
    Setting().set('core.cors.allow_origin', os.environ.get('CORS_ALLOWED_ORIGINS', 'http://localhost:8080, http://localhost:8010'))


def run_girder_init():
    createInitialUser()
    createAssetstore()
    configure()


if __name__ == "__main__":
    run_girder_init()
