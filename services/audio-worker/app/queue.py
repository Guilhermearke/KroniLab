"""
Fila de jobs (item 30/31).

A GPU nao fica ligada 24h: a API so enfileira, o worker sobe, drena a fila e
morre. Redis em producao, memoria em dev/CI — mesma interface.
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections import deque

from .models import JobRequest


class JobQueue(ABC):
    @abstractmethod
    def push(self, job: JobRequest) -> None: ...

    @abstractmethod
    def pop(self, timeout: int = 30) -> JobRequest | None: ...

    @abstractmethod
    def depth(self) -> int: ...


class MemoryQueue(JobQueue):
    def __init__(self) -> None:
        self._items: deque[JobRequest] = deque()

    def push(self, job: JobRequest) -> None:
        self._items.append(job)

    def pop(self, timeout: int = 30) -> JobRequest | None:
        return self._items.popleft() if self._items else None

    def depth(self) -> int:
        return len(self._items)


class RedisQueue(JobQueue):
    def __init__(self, url: str, name: str):
        import redis

        self._redis = redis.from_url(url)
        self._name = name

    def push(self, job: JobRequest) -> None:
        self._redis.rpush(self._name, job.model_dump_json())

    def pop(self, timeout: int = 30) -> JobRequest | None:
        item = self._redis.blpop(self._name, timeout=timeout)
        if item is None:
            return None
        return JobRequest(**json.loads(item[1]))

    def depth(self) -> int:
        return int(self._redis.llen(self._name))
