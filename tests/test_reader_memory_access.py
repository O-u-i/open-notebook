"""Mei memory must not inherit the application's permissive CORS boundary."""

import pytest
from starlette.requests import Request

from api.routers.reader_memory import require_loopback
from open_notebook.exceptions import ConfigurationError


def request(client: str, origin: str | None = None) -> Request:
    headers = [(b"origin", origin.encode("ascii"))] if origin is not None else []
    return Request({"type": "http", "headers": headers, "client": (client, 12345)})


@pytest.mark.parametrize(
    "origin",
    [None, "http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"],
)
def test_local_cli_and_default_frontend_are_allowed(monkeypatch, origin):
    monkeypatch.delenv("OPEN_NOTEBOOK_MEI_TRUSTED_ORIGINS", raising=False)
    require_loopback(request("127.0.0.1", origin))


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "",
        "null",
        "http://127.0.0.1:3001",
        "http://localhost.evil.example:3000",
    ],
)
def test_untrusted_browser_origin_is_denied(monkeypatch, origin):
    monkeypatch.delenv("OPEN_NOTEBOOK_MEI_TRUSTED_ORIGINS", raising=False)
    with pytest.raises(ConfigurationError):
        require_loopback(request("127.0.0.1", origin))


def test_configured_origin_must_still_be_local(monkeypatch):
    monkeypatch.setenv(
        "OPEN_NOTEBOOK_MEI_TRUSTED_ORIGINS",
        "http://localhost:3001,https://evil.example:443",
    )
    require_loopback(request("127.0.0.1", "http://localhost:3001"))
    with pytest.raises(ConfigurationError):
        require_loopback(request("127.0.0.1", "https://evil.example:443"))


def test_remote_clients_are_denied_even_for_allowed_origin():
    with pytest.raises(ConfigurationError):
        require_loopback(request("192.0.2.1", "http://localhost:3000"))
