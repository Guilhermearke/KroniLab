"""Cloudflare R2 (API S3) para os arquivos grandes; disco local em dev."""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
import shutil


class Storage(ABC):
    @abstractmethod
    def upload(self, path: Path, key: str) -> str: ...

    @abstractmethod
    def signed_url(self, key: str, expires_in: int = 3600) -> str: ...


class R2Storage(Storage):
    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str):
        import boto3

        self._bucket = bucket
        self._client = boto3.client(
            "s3", endpoint_url=endpoint,
            aws_access_key_id=access_key, aws_secret_access_key=secret_key,
        )

    def upload(self, path: Path, key: str) -> str:
        self._client.upload_file(str(path), self._bucket, key)
        return key

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        return self._client.generate_presigned_url(
            "get_object", Params={"Bucket": self._bucket, "Key": key}, ExpiresIn=expires_in
        )


class LocalStorage(Storage):
    def __init__(self, root: Path):
        self.root = root

    def upload(self, path: Path, key: str) -> str:
        target = self.root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        return key

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        return f"file://{self.root / key}"
