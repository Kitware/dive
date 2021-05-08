from pydantic import BaseModel, BaseSettings, AnyHttpUrl
from urllib.parse import urlparse


class Settings(BaseSettings):
    username: str = "guest"
    password: str = "guest"
    # Default vhost name is "/" which escapes poorly in urls
    # https://lists.rabbitmq.com/pipermail/rabbitmq-discuss/2012-March/019182.html
    vhost: str = "default"
    # Library author has no idea how to handle urls properly...
    # https://github.com/deslum/pyrabbit2/blob/master/pyrabbit2/http.py#L72
    url: AnyHttpUrl = "rabbit:15672"

    @property
    def netloc(self):
        parsed = urlparse(self.url)
        return parsed.netloc

    @property
    def scheme(self):
        parsed = urlparse(self.url)
        return parsed.scheme

    class Config:
        case_sensitive = False
        env_prefix = 'rabbitmq_management_'


class UserQueueModel(BaseModel):
    """Credentials to an unspecified RabbitMQ Instance"""

    username: str
    password: str
