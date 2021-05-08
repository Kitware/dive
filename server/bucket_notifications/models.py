from pydantic import BaseModel
from dive_server.utils import PydanticModel


class GCSObjectFinalizeNotification(BaseModel):
    bucketId: str
    objectId: str
    eventType: str


class GCSPushNotificationMessage(BaseModel):
    attributes: GCSObjectFinalizeNotification
    data: str
    messageId: str
    publishTime: str


class GCSPushNotificationPayload(BaseModel):
    """
    https://cloud.google.com/pubsub/docs/push#receiving_messages
    https://cloud.google.com/storage/docs/pubsub-notifications
    https://cloud.google.com/storage/docs/object-change-notification#_Notification_Types
    """

    message: GCSPushNotificationMessage
    subscription: str


class GCSNotificationRecord(PydanticModel):
    def initialize(self):
        return super().initialize("gcsnotification", GCSPushNotificationMessage)


class NotificationRouterRule(BaseModel):
    folderId: str
