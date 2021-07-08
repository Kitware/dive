from urllib.parse import quote as urlquote, urlparse

from pydantic import BaseModel, BaseSettings


class Settings(BaseSettings):
    username: str = "guest"
    password: str = "guest"
    # Default vhost name is "/" which escapes poorly in urls, so change it to default
    # https://lists.rabbitmq.com/pipermail/rabbitmq-discuss/2012-March/019182.html
    vhost: str = "default"
    # Library author has no idea how to handle urls properly...
    # https://github.com/deslum/pyrabbit2/blob/master/pyrabbit2/http.py#L72
    url: str = "http://rabbit:15672"
    broker_url_template: str = r"amqp://{}:{}@rabbit/default"

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

    def with_broker_url(self, template: str) -> dict:
        value = self.dict()
        value['broker_url'] = template.format(urlquote(self.username), urlquote(self.password))
        return value
