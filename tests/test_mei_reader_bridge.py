"""Synthetic Mei bridge checks; MEI_TEST_ROOT selects the installed scripts only."""

import importlib.util
import json
import os
import shutil
import sys
import uuid
from pathlib import Path

import pytest

MEI = Path(os.environ.get("MEI_TEST_ROOT", ""))
pytestmark = pytest.mark.skipif(
    not os.environ.get("MEI_TEST_ROOT"),
    reason="Set MEI_TEST_ROOT for Mei integration checks",
)


@pytest.fixture
def bridge(monkeypatch):
    monkeypatch.syspath_prepend(str(MEI / "scripts"))
    spec = importlib.util.spec_from_file_location(
        "mei_reader_bridge",
        Path(__file__).parents[1] / "scripts" / "mei_reader_bridge.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def fake_mei():
    # Leave fixtures under the ignored local deployment directory; no batch cleanup.
    root = Path.cwd() / ".local-deployment" / "mei-bridge-tests" / uuid.uuid4().hex
    vault = root / "memory" / "markdown"
    (root / "local").mkdir(parents=True)
    (root / "schemas").mkdir()
    shutil.copy2(MEI / "schemas" / "memory-note.schema.json", root / "schemas")
    sys.path.insert(0, str(MEI / "scripts"))
    from memory_markdown import initialize_memory

    initialize_memory(vault)
    (vault / ".obsidian").mkdir()
    (root / "local" / "paths.toml").write_text(
        f"[paths]\nmei_root = '{root.as_posix()}'\nmemory_root = '{vault.as_posix()}'\n"
        f"obsidian_vault = '{vault.as_posix()}'\nobsidian_memory_dir = ''\n",
        encoding="utf-8",
    )
    return root, vault


def test_snapshot_cas_references_only(bridge, fake_mei):
    root, _ = fake_mei
    initial = bridge.snapshot(root, {"source_id": "source:test"}, write=False)
    assert initial["revision"] is None
    state = {
        "page": 3,
        "sessions": ["chat_session:a"],
        "helper_session": None,
        "quotes": [{"page_start": 2, "page_end": 3, "sha256": "a" * 64}],
    }
    saved = bridge.snapshot(
        root,
        {"source_id": "source:test", "revision": None, "snapshot": state},
        write=True,
    )
    assert (
        bridge.snapshot(root, {"source_id": "source:test"}, write=False)["snapshot"][
            "page"
        ]
        == 3
    )
    with pytest.raises(ValueError, match="changed"):
        bridge.snapshot(
            root,
            {"source_id": "source:test", "revision": None, "snapshot": state},
            write=True,
        )
    state["page"] = 4
    updated = bridge.snapshot(
        root,
        {"source_id": "source:test", "revision": saved["revision"], "snapshot": state},
        write=True,
    )
    assert updated["revision"] != saved["revision"]
    state["raw_conversation"] = "not allowed"
    with pytest.raises(ValueError, match="fields"):
        bridge.snapshot(
            root,
            {
                "source_id": "source:test",
                "revision": updated["revision"],
                "snapshot": state,
            },
            write=True,
        )


def test_host_search_preview_and_drift(bridge, fake_mei):
    root, vault = fake_mei
    host1, host2 = root / "gui1", root / "gui2"
    host1.mkdir()
    host2.mkdir()
    index = host1 / "MEMORY.md"
    index.write_text("Header\nSynthetic topic evidence\nFooter\n", encoding="utf-8")
    (host1 / "raw_memories.md").write_text(
        "Synthetic topic forbidden raw session", encoding="utf-8"
    )
    (host2 / "memory_summary.md").write_text("Synthetic unrelated\n", encoding="utf-8")
    paths = {
        "codex_memory_source_gui1": str(host1),
        "codex_memory_source_gui2": str(host2),
    }
    matches = bridge.search(root, vault, paths, {"query": "topic"})["matches"]
    assert len(matches) == 1 and matches[0]["kind"] == "gui1"
    assert (
        "Synthetic topic evidence"
        in bridge.preview(root, vault, paths, matches[0])["text"]
    )
    index.write_text("Changed\n", encoding="utf-8")
    with pytest.raises(ValueError, match="changed"):
        bridge.preview(root, vault, paths, matches[0])
    with pytest.raises(ValueError):
        bridge.preview(root, vault, paths, {**matches[0], "id": "raw_memories.md:1:1"})


def test_candidate_requires_review_and_rejects_secrets(bridge, fake_mei):
    root, vault = fake_mei
    request = {
        "source_id": "source:test",
        "page": 3,
        "session_id": None,
        "claim": "Synthetic research note to review.",
    }
    result = bridge.candidate(root, request)
    assert result["status"] == "previewed"
    assert (vault / result["review_card"]).is_file()
    assert not list((vault / "project").glob("open-notebook-*.md"))
    evidence = list(
        (root / "memory" / "proposals" / "evidence" / "open-notebook").glob("*.json")
    )
    assert (
        len(evidence) == 1
        and json.loads(evidence[0].read_text(encoding="utf-8"))["page"] == 3
    )
    with pytest.raises(ValueError):
        bridge.candidate(root, {**request, "claim": "api_key=do-not-store"})
