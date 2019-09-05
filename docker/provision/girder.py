import os

import girder_client
import requests

ADMIN_USER = 'admin'
ADMIN_PASS = 'letmein'


"""These functions should all be idempotent - should have no effect when 
fired off multiple times
"""
def setGirderSetting(key, value, gc):
    return gc.put("/system/setting",
           parameters={
               "key"  : key,
               "value": value
           }
           )


def createInitialUser(apiUrl):
    # no try required here, just get a 400 on failure
    res = requests.post(
        '{}/user'.format(apiUrl),
        data={"login"    : ADMIN_USER, "email": "admin@admin.com",
              "firstName": ADMIN_USER, "password": ADMIN_PASS,
              "lastName" : ADMIN_USER, "admin": True})


def createAssetstore(gc, name='assetstore', path='/home/assetstore'):
    try:
        res = gc.post("/assetstore",
            parameters={'name': name, 'type': 0,
                        'root': path})
    except girder_client.HttpError as exc:
        print(exc)


def check_admin_login(apiUrl):
    gc = girder_client.GirderClient(apiUrl=apiUrl)

    try:
        gc.authenticate(ADMIN_USER, ADMIN_PASS)
    except girder_client.AuthenticationError:
        print('Cannot login admin, it probably does not exist')
        return False
    return True


def run_girder_init(apiUrl):
    ## Ideally each of these calls should be idempotent
    createInitialUser(apiUrl)
    gc = girder_client.GirderClient(apiUrl=apiUrl)
    gc.authenticate("admin", "letmein")
    setGirderSetting("worker.api_url", "http://girder:8080/api/v1", gc)
    setGirderSetting("worker.broker", "amqp://guest:guest@rabbit/", gc)
    setGirderSetting("worker.backend", "amqp://guest:guest@rabbit/", gc)
    createAssetstore(gc)


if __name__ == '__main__':
    GIRDER_INNER_HOST = 'girder'
    GIRDER_INNER_PORT = os.environ.get('GIRDER_INNER_PORT', 8080)
    if not GIRDER_INNER_PORT:
        raise RuntimeError('You must set the env variable GIRDER_INNER_PORT')

    girder_url = "http://{host}:{port}/api/v1".format(host=GIRDER_INNER_HOST,
                                                      port=GIRDER_INNER_PORT)
    run_girder_init(girder_url)
