"""Narrow local bridge to Mei; stdin/stdout JSON, never a general shell or writer.

Runtime roots come only from the operator environment and Mei's local paths.
Only index/summary host memories may be searched; raw sessions and credentials
are never opened. Canonical promotion is deliberately not exposed here.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tomllib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def record_id(value: str, kind: str) -> str:
    if not re.fullmatch(rf"{kind}:[a-zA-Z0-9_-]{{1,120}}", value):
        raise ValueError(f"invalid {kind} ID")
    return value


def setup() -> tuple[Path, Path, dict[str, str]]:
    configured = os.environ.get("OPEN_NOTEBOOK_MEI_ROOT")
    if not configured:
        raise ValueError("Mei integration is not configured")
    root = Path(configured).expanduser().resolve(strict=True)
    if (root / "VERSION").read_text(encoding="utf-8").strip() != "v2.0.0":
        raise ValueError("unsupported Mei version")
    sys.path.insert(0, str(root / "scripts"))
    from memory_markdown import _assert_no_reparse, resolve_memory_root

    _assert_no_reparse(root)
    config = tomllib.loads((root / "local" / "paths.toml").read_text(encoding="utf-8"))
    paths = config.get("paths", {})
    return root, resolve_memory_root(root), paths


def host_file(paths: dict[str, str], host: str, name: str) -> Path:
    from memory_markdown import _assert_no_reparse, _relative
    from migrate_codex_memory import classify

    if host not in {"gui1", "gui2"} or name not in {"MEMORY.md", "memory_summary.md"}:
        raise ValueError("host memory locator is not allowed")
    if classify(name) not in {"durable_index", "summary"}:
        raise ValueError("host memory class is not allowed")
    root = Path(paths[f"codex_memory_source_{host}"])
    _assert_no_reparse(root)
    file = _relative(root, name, "host memory")
    if not file.is_file() or file.stat().st_size > 2_000_000:
        raise ValueError("host memory is missing or exceeds its cap")
    return file


def search(root: Path, vault: Path, paths: dict[str, str], request: dict) -> dict:
    from memory import search_memory
    from migrate_codex_memory import _privacy

    query = request.get("query", "").strip()
    if not 1 <= len(query) <= 120:
        raise ValueError("search term must be 1–120 characters")
    matches = []
    for note in search_memory(vault, query, schema_root=root)[:6]:
        matches.append(
            {
                "kind": "mei",
                "id": note["memory_id"],
                "revision": note["sha256"],
                "label": note["description"],
                "scope": note["scope"],
            }
        )
    # Only two bounded, explicitly named index files per configured host.
    for host in ("gui1", "gui2"):
        host_matches = 0
        for name in ("MEMORY.md", "memory_summary.md"):
            try:
                raw = host_file(paths, host, name).read_bytes()
                lines = raw.decode("utf-8").splitlines()
            except (OSError, UnicodeError, KeyError, ValueError):
                continue
            revision = sha(raw)
            for index, line in enumerate(lines):
                if query.casefold() not in line.casefold():
                    continue
                start, end = max(0, index - 2), min(len(lines), index + 3)
                excerpt = "\n".join(lines[start:end])[:4000]
                if _privacy(excerpt.encode("utf-8")) != "clean":
                    continue
                matches.append(
                    {
                        "kind": host,
                        "id": f"{name}:{start + 1}:{end}",
                        "revision": revision,
                        "label": f"{host.upper()} · {name} · {start + 1}–{end}",
                        "scope": "unverified development memory; preview before use",
                    }
                )
                host_matches += 1
                if host_matches >= 6:
                    break
            if host_matches >= 6:
                break
    return {"matches": matches}


def preview(root: Path, vault: Path, paths: dict[str, str], request: dict) -> dict:
    from memory import read
    from migrate_codex_memory import _privacy

    kind, locator, revision = (
        request.get("kind"),
        request.get("id", ""),
        request.get("revision", ""),
    )
    if not re.fullmatch(r"[a-f0-9]{64}", revision):
        raise ValueError("invalid source revision")
    if kind == "mei":
        notes = read(vault, {locator}, schema_root=root)["notes"]
        if len(notes) != 1 or notes[0]["sha256"] != revision:
            raise ValueError("memory changed; search and preview it again")
        body = notes[0]["body"]
        return {
            "text": body[:6000],
            "truncated": len(body) > 6000,
            "revision": revision,
        }
    match = re.fullmatch(
        r"(MEMORY\.md|memory_summary\.md):(\d{1,7}):(\d{1,7})", locator
    )
    if kind not in {"gui1", "gui2"} or not match:
        raise ValueError("invalid host memory locator")
    raw = host_file(paths, kind, match.group(1)).read_bytes()
    if sha(raw) != revision:
        raise ValueError("memory changed; search and preview it again")
    start, end = int(match.group(2)), int(match.group(3))
    lines = raw.decode("utf-8").splitlines()
    if start < 1 or end < start or end > len(lines) or end - start > 4:
        raise ValueError("invalid host excerpt range")
    excerpt = "\n".join(lines[start - 1 : end])
    if _privacy(excerpt.encode("utf-8")) != "clean":
        raise ValueError("excerpt requires privacy review")
    return {
        "text": excerpt[:4000],
        "truncated": len(excerpt) > 4000,
        "revision": revision,
    }


def snapshot(root: Path, request: dict, *, write: bool) -> dict:
    from _common import check_private_content
    from checkpoint_continuity import _context_lock
    from memory_markdown import _assert_no_reparse
    from review_proposals import _atomic_write

    source = record_id(request.get("source_id", ""), "source")
    directory = root / "memory" / "episodic" / "open-notebook"
    _assert_no_reparse(directory)
    if write:
        directory.mkdir(parents=True, exist_ok=True)
        _assert_no_reparse(directory)
    if not directory.is_dir():
        return {"snapshot": None, "revision": None}
    path = directory / f"{sha(source.encode())[:32]}.json"
    _assert_no_reparse(path)
    with _context_lock(directory, 5.0):
        current = path.read_bytes() if path.is_file() else None
        if current and len(current) > 16_384:
            raise ValueError("snapshot exceeds size limit")
        current_revision = sha(current) if current else None
        if not write:
            value = json.loads(current) if current else None
            if value and value.get("source_id") != source:
                raise ValueError("snapshot source mismatch")
            return {"snapshot": value, "revision": current_revision}
        if request.get("revision") != current_revision:
            raise ValueError("snapshot changed; reload before saving")
        value = request.get("snapshot")
        if not isinstance(value, dict) or set(value) != {
            "page",
            "sessions",
            "helper_session",
            "quotes",
        }:
            raise ValueError("invalid snapshot fields")
        page, sessions, helper, quotes = (
            value["page"],
            value["sessions"],
            value["helper_session"],
            value["quotes"],
        )
        if (
            not isinstance(page, int)
            or isinstance(page, bool)
            or not 1 <= page <= 100_000
        ):
            raise ValueError("invalid page")
        if (
            not isinstance(sessions, list)
            or len(sessions) > 2
            or len(set(sessions)) != len(sessions)
        ):
            raise ValueError("invalid sessions")
        for session in sessions:
            record_id(session, "chat_session")
        if helper is not None:
            record_id(helper, "chat_session")
        if not isinstance(quotes, list) or len(quotes) > 8:
            raise ValueError("invalid quote references")
        for item in quotes:
            if (
                not isinstance(item, dict)
                or set(item) != {"page_start", "page_end", "sha256"}
                or not isinstance(item["page_start"], int)
                or not isinstance(item["page_end"], int)
                or not 1 <= item["page_start"] <= item["page_end"] <= 100_000
                or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
            ):
                raise ValueError("invalid quote reference")
        # Short-term memory stores references/hashes, not document text or chat logs.
        saved = {
            "source_id": source,
            **value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        check_private_content(saved)
        raw = (json.dumps(saved, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        _atomic_write(path, raw, expected_sha256=sha(current or b""))
        return {"snapshot": saved, "revision": sha(raw)}


def candidate(root: Path, request: dict) -> dict:
    from _common import check_private_content
    from memory_markdown import _assert_no_reparse, render_note
    from review_proposals import draft_proposal, preview_proposal

    source = record_id(request.get("source_id", ""), "source")
    page = request.get("page")
    claim = request.get("claim", "").strip()
    session = request.get("session_id")
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 100_000:
        raise ValueError("invalid page")
    if not 1 <= len(claim) <= 1200:
        raise ValueError("write a short summary of at most 1200 characters")
    if session is not None:
        record_id(session, "chat_session")
    evidence = {
        "source_id": source,
        "page": page,
        "session_id": session,
        "user_summary": claim,
    }
    check_private_content(evidence)
    memory_id = f"open-notebook-{uuid.uuid4().hex[:16]}"
    relative = f"memory/proposals/evidence/open-notebook/{memory_id}.json"
    path = root / relative
    _assert_no_reparse(path.parent)
    path.parent.mkdir(parents=True, exist_ok=True)
    _assert_no_reparse(path.parent)
    raw = (json.dumps(evidence, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with path.open("xb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    now = datetime.now(timezone.utc).isoformat()
    note: dict[str, Any] = {
        "schema_version": "v0.2.0",
        "memory_id": memory_id,
        "category": "project",
        "status": "active",
        "scope": "Open Notebook paper-reading notes",
        "description": claim.replace("\n", " ")[:200],
        "source": relative,
        "source_format": "markdown",
        "provenance": [
            {
                "source": relative,
                "locator": "user_summary",
                "evidence_type": "current_file",
                "verified_at": now,
            }
        ],
        "review_due_at": None,
        "review_triggers": ["The source or the user's interpretation changes"],
        "references": [],
        "conflicts": [],
        "related": [],
        "relations": [],
        "updated_at": now,
        "migrated_from": None,
        "migrated_at": None,
        "body": f"## Claim\n\n{claim}\n\n## Evidence\n\nUser-selected source `{source}`, page {page}; review against the paper before promotion.\n",
    }
    content = render_note(note, root)
    result = draft_proposal(
        "personal_markdown",
        f"memory/markdown/project/{memory_id}.md",
        content,
        scope=note["scope"],
        source={"kind": "file", "locator": relative, "sha256": sha(raw)},
        reason="User requested a review candidate; no automatic promotion.",
        mei_root=root,
    )
    if result.get("status") != "drafted":
        raise ValueError("Mei could not create the review candidate")
    previewed = preview_proposal(result["proposal_id"], mei_root=root)
    return {
        "proposal_id": result["proposal_id"],
        "status": previewed["status"],
        "review_card": result["card_locator"],
    }


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(32_769)
        if len(raw) > 32_768:
            raise ValueError("request too large")
        request = json.loads(raw.decode("utf-8"))
        if not isinstance(request, dict):
            raise ValueError("invalid request")
        root, vault, paths = setup()
        action = sys.argv[1] if len(sys.argv) == 2 else ""
        if action == "status":
            result = {
                "enabled": vault.is_dir(),
                "hosts": [
                    host
                    for host in ("gui1", "gui2")
                    if Path(paths.get(f"codex_memory_source_{host}", "")).is_dir()
                ],
            }
        elif action == "search":
            result = search(root, vault, paths, request)
        elif action == "preview":
            result = preview(root, vault, paths, request)
        elif action in {"snapshot_read", "snapshot_write"}:
            result = snapshot(root, request, write=action == "snapshot_write")
        elif action == "candidate":
            result = candidate(root, request)
        else:
            raise ValueError("unsupported action")
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        # No source bodies, secret values, or paths are logged to the API.
        print(
            json.dumps({"ok": False, "error": type(exc).__name__}, ensure_ascii=False)
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
