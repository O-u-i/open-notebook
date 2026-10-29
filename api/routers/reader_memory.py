"""Opt-in, loopback-only Mei reader memory access.

The bridge accepts a short allowlisted command and JSON on stdin. It is not a
general-purpose file, shell, memory-apply or profile interface.
"""

import asyncio
import ipaddress
import json
import os
import sys
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from api.routers._chat_shared import get_source_or_404, get_verified_source_session
from open_notebook.exceptions import ConfigurationError, InvalidInputError

router = APIRouter(prefix="/reader-memory")
BRIDGE = Path(__file__).resolve().parents[2] / "scripts" / "mei_reader_bridge.py"


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=120)


class PreviewRequest(BaseModel):
    kind: Literal["mei", "gui1", "gui2"]
    id: str = Field(min_length=1, max_length=160)
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")


class QuoteReference(BaseModel):
    page_start: int = Field(ge=1, le=100_000)
    page_end: int = Field(ge=1, le=100_000)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ReadingState(BaseModel):
    page: int = Field(ge=1, le=100_000)
    sessions: list[str] = Field(default_factory=list, max_length=2)
    helper_session: Optional[str] = None
    quotes: list[QuoteReference] = Field(default_factory=list, max_length=8)


class SnapshotRequest(BaseModel):
    revision: Optional[str] = Field(None, pattern=r"^[a-f0-9]{64}$")
    snapshot: ReadingState


class CandidateRequest(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    page: int = Field(ge=1, le=100_000)
    session_id: Optional[str] = None
    claim: str = Field(min_length=1, max_length=1200)


def require_loopback(request: Request) -> None:
    try:
        if (
            not request.client
            or not ipaddress.ip_address(request.client.host).is_loopback
        ):
            raise ValueError("non-loopback client")
    except ValueError as exc:
        raise ConfigurationError(
            "Mei reader memory is available only on this machine"
        ) from exc
    # A local API can still be reached by JavaScript on an unrelated website.
    # Do not rely on the application's intentionally permissive default CORS.
    origin = request.headers.get("origin")
    if origin is not None:
        allowed = {
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://[::1]:3000",
        }
        allowed.update(
            value.strip()
            for value in os.environ.get("OPEN_NOTEBOOK_MEI_TRUSTED_ORIGINS", "").split(
                ","
            )
            if value.strip()
        )
        try:
            parsed = urlsplit(origin)
            host = parsed.hostname
            local_host = host == "localhost" or (
                host is not None and ipaddress.ip_address(host).is_loopback
            )
            valid_origin = (
                parsed.scheme in {"http", "https"}
                and local_host
                and parsed.username is None
                and parsed.password is None
                and not parsed.path
                and not parsed.query
                and not parsed.fragment
                and parsed.port is not None
            )
        except ValueError:
            valid_origin = False
        if not valid_origin or origin not in allowed:
            raise ConfigurationError(
                "Mei reader memory rejected an untrusted browser origin"
            )


async def run_bridge(request: Request, action: str, payload: dict) -> dict:
    require_loopback(request)
    root = os.environ.get("OPEN_NOTEBOOK_MEI_ROOT")
    if not root:
        raise ConfigurationError("Mei reader memory is not configured")
    # Do not hand the bridge model credentials or database secrets.
    env = {
        key: os.environ[key]
        for key in ("SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP")
        if key in os.environ
    }
    env.update(
        OPEN_NOTEBOOK_MEI_ROOT=root,
        PYTHONIOENCODING="utf-8",
        PYTHONDONTWRITEBYTECODE="1",
    )
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-X",
        "utf8",
        "-B",
        str(BRIDGE),
        action,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env=env,
    )
    stdout, _ = await process.communicate(
        json.dumps(payload, ensure_ascii=False).encode("utf-8")
    )
    try:
        data = json.loads(stdout)
    except (ValueError, UnicodeError) as exc:
        raise ConfigurationError(
            "Mei reader memory returned an invalid response"
        ) from exc
    if process.returncode != 0 or not data.get("ok"):
        # The detailed bridge error intentionally contains no personal content.
        raise InvalidInputError(
            "Mei memory request failed or the source changed; search or reload again"
        )
    return data


@router.get("/status")
async def status(request: Request):
    if not os.environ.get("OPEN_NOTEBOOK_MEI_ROOT"):
        require_loopback(request)
        return {"enabled": False, "hosts": []}
    return await run_bridge(request, "status", {})


@router.post("/search")
async def search_memory(request: Request, body: SearchRequest):
    return await run_bridge(request, "search", body.model_dump())


@router.post("/preview")
async def preview_memory(request: Request, body: PreviewRequest):
    return await run_bridge(request, "preview", body.model_dump())


@router.get("/snapshots/{source_id}")
async def read_snapshot(request: Request, source_id: str):
    full_id, _ = await get_source_or_404(source_id)
    return await run_bridge(request, "snapshot_read", {"source_id": full_id})


@router.put("/snapshots/{source_id}")
async def write_snapshot(request: Request, source_id: str, body: SnapshotRequest):
    full_id, _ = await get_source_or_404(source_id)
    if len(body.snapshot.sessions) != len(set(body.snapshot.sessions)):
        raise InvalidInputError("Snapshot sessions must be distinct")
    for session_id in body.snapshot.sessions:
        _, _, _, session = await get_verified_source_session(full_id, session_id)
        if getattr(session, "purpose", "main") != "main":
            raise InvalidInputError("Snapshot main session has the wrong purpose")
    if body.snapshot.helper_session:
        _, _, _, session = await get_verified_source_session(
            full_id, body.snapshot.helper_session
        )
        if getattr(session, "purpose", "main") != "reader_assistant":
            raise InvalidInputError("Snapshot assistant session has the wrong purpose")
    payload = {"source_id": full_id, **body.model_dump()}
    return await run_bridge(request, "snapshot_write", payload)


@router.post("/candidates")
async def create_candidate(request: Request, body: CandidateRequest):
    full_id, _ = await get_source_or_404(body.source_id)
    if body.session_id:
        await get_verified_source_session(full_id, body.session_id)
    payload = body.model_dump()
    payload["source_id"] = full_id
    return await run_bridge(request, "candidate", payload)
