"""Snapshot publication — the writer port and its two adapters.

Snapshots go to Google Cloud Storage in production, because the ETL runs on Cloud
Run Jobs and staying in-GCP avoids cross-cloud egress on every sweep. A local
directory adapter exists so the entire pipeline runs and is tested without any
cloud access, which is what keeps development free and the test suite offline.

The writer is a port so the orchestrator never knows which target it has. Each
snapshot is written as camelCase JSON, matching the TypeScript contract, and the
key comes from the same helper the reader uses so the two cannot disagree about
where a document lives.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

from .errors import StoreError

__all__ = [
    "GcsBlobLike",
    "GcsBucketLike",
    "GcsClientLike",
    "GcsWriter",
    "LocalDirWriter",
    "SnapshotWriter",
    "snapshot_key",
]


@runtime_checkable
class GcsBlobLike(Protocol):
    """The slice of a GCS blob this writer uses."""

    def upload_from_string(self, body: str, content_type: str) -> None:
        """Upload the blob's body.

        Args:
            body: The content to upload.
            content_type: The MIME type to record.
        """
        ...


@runtime_checkable
class GcsBucketLike(Protocol):
    """The slice of a GCS bucket this writer uses."""

    def blob(self, name: str) -> GcsBlobLike:
        """Return a handle for one object.

        Args:
            name: The object name within the bucket.

        Returns:
            The blob handle.
        """
        ...


@runtime_checkable
class GcsClientLike(Protocol):
    """The slice of the storage client this writer uses.

    Declared structurally rather than importing the SDK at module scope, so the
    module type-checks and unit-tests without credentials *and* without the SDK
    installed — the local-only path stays dependency-free, and the writer is the
    only place the SDK is touched (dependency inversion).
    """

    def bucket(self, name: str) -> GcsBucketLike:
        """Return a handle for one bucket.

        Args:
            name: The bucket name.

        Returns:
            The bucket handle.
        """
        ...


def snapshot_key(kind: str, slug: str) -> str:
    """Build the object key for a snapshot.

    Mirrors `snapshotKey` in the TypeScript contract. Defined in one place per
    language and asserted equal by the drift test, so a reader and a writer can
    never disagree about where a document lives.

    Args:
        kind: The snapshot family — ``chains``, ``protocols`` or ``market-makers``.
        slug: The entity slug.

    Returns:
        The key, relative to the configured prefix.

    Examples:
        >>> snapshot_key("chains", "base")
        'chains/base.json'
    """
    return f"{kind}/{slug}.json"


#: The key of the run manifest.
MANIFEST_KEY = "manifest.json"


@runtime_checkable
class SnapshotWriter(Protocol):
    """Port: persist snapshot documents."""

    def write(self, key: str, body: str) -> None:
        """Write one document, overwriting any existing value.

        Args:
            key: Key relative to the configured prefix.
            body: The serialized document.

        Raises:
            StoreError: When the write fails.
        """
        ...


class LocalDirWriter:
    """A :class:`SnapshotWriter` over the local filesystem.

    Args:
        root: Directory that keys resolve beneath. Created on first write.
    """

    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        """The directory snapshots are written beneath.

        Returns:
            The configured root path.
        """
        return self._root

    def write(self, key: str, body: str) -> None:
        """Write one document beneath the root.

        Args:
            key: Key relative to the root.
            body: The serialized document.

        Raises:
            StoreError: When the path cannot be written.
        """
        path = self._root / key
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
        except OSError as exc:
            raise StoreError("write", key, str(exc), exc) from exc


class GcsWriter:
    """A :class:`SnapshotWriter` over a Google Cloud Storage bucket.

    The bucket object is injected rather than constructed here, so the
    orchestrator owns credential handling and a test can supply a fake. The
    ``google-cloud-storage`` import is deliberately avoided at module scope so the
    local path needs no cloud SDK installed.

    Args:
        bucket_name: The target bucket.
        prefix: Key prefix within the bucket, e.g. ``risk``.
        client: An optional pre-built storage client, for tests or for reusing an
            authenticated client across writes.
    """

    def __init__(self, bucket_name: str, prefix: str, client: GcsClientLike | None = None) -> None:
        self._bucket_name = bucket_name
        self._prefix = prefix.rstrip("/")
        self._client = client
        self._bucket: GcsBucketLike | None = None

    def _ensure_bucket(self) -> GcsBucketLike:
        """Return the bucket handle, constructing the client on first use.

        Returns:
            The bucket object.

        Raises:
            StoreError: When the storage client or bucket cannot be constructed —
                a configuration problem, reported once with the bucket name.
        """
        if self._bucket is not None:
            return self._bucket
        try:
            if self._client is None:
                from google.cloud import storage

                self._client = storage.Client()
            self._bucket = self._client.bucket(self._bucket_name)
        except Exception as exc:
            raise StoreError(
                "write",
                self._bucket_name,
                f"could not construct a GCS client for bucket {self._bucket_name!r}: {exc}",
                exc,
            ) from exc
        return self._bucket

    def write(self, key: str, body: str) -> None:
        """Upload one document to the bucket.

        Args:
            key: Key relative to the configured prefix.
            body: The serialized document.

        Raises:
            StoreError: When the upload fails.
        """
        object_name = f"{self._prefix}/{key}"
        try:
            bucket = self._ensure_bucket()
            blob = bucket.blob(object_name)
            blob.upload_from_string(body, content_type="application/json")
        except StoreError:
            raise
        except Exception as exc:
            raise StoreError("write", object_name, str(exc), exc) from exc
