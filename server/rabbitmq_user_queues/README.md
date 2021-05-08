# RabbitMQ User Queues

Generate custom user credentials for girder users to have their own RabbitMQ Celery Queues.

## Configuration

Specify management connection information with env variables

``` env
RABBITMQ_MANAGEMENT_USERNAME
RABBITMQ_MANAGEMENT_PASSWORD
RABBITMQ_MANAGEMENT_VHOST
RABBITMQ_MANAGEMENT_URL
```

## Documentation

https://rawcdn.githack.com/rabbitmq/rabbitmq-server/v3.8.16/deps/rabbitmq_management/priv/www/api/index.html

https://www.rabbitmq.com/management.html

https://pyrabbit.readthedocs.io/en/latest/api.html
