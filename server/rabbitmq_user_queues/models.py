from pydantic import (
    BaseModel,
    BaseSettings,
    AnyHttpUrl
)


class Settings(BaseSettings):
    username: str
    password: str
    vhost: str
    url: AnyHttpUrl

    class Config:
        case_sensitive = False
        env_prefix = 'rabbitmq_management_'


class UserQueueModel(BaseModel):
    """Credentials to an unspecified RabbitMQ Instance"""
    username: str
    password: str

