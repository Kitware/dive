from girder_client import GirderClient, HttpError
import pytest

from .conftest import users


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=2)
def test_user_creation(admin_client: GirderClient, user: dict):
    try:
        admin_client.createUser(
            user['login'],
            user['email'],
            user['firstName'],
            user['lastName'],
            user['password'],
        )
    except HttpError as err:
        if err.response.json()['message'] != 'That login is already registered.':
            raise err
