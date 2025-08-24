import os
from rq import Queue
from redis import Redis

def get_redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")

def get_queue(name: str = "simc") -> Queue:
    return Queue(name, connection=Redis.from_url(get_redis_url()))
