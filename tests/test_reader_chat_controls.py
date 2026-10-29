"""Offline checks for reader-chat isolation and native reasoning controls."""

import json
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI

from open_notebook.ai.reasoning import (
    configure_chat_model,
    supported_reasoning_efforts,
    validate_reasoning_effort,
)
from open_notebook.exceptions import ConfigurationError, RateLimitError
from open_notebook.utils.graph_utils import invoke_chat_turn


@pytest.mark.parametrize(
    "effort,tokens,seconds", [("low", 8192, 180), ("max", 32768, 540)]
)
def test_reasoning_wire_options_and_client_copy(effort, tokens, seconds):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "id": "test",
                "object": "chat.completion",
                "created": 1,
                "model": "gpt-6.1-sol",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "OK"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    transport = httpx.MockTransport(respond)
    sync = httpx.Client(transport=transport)
    asynchronous = httpx.AsyncClient(transport=transport)
    original = ChatOpenAI(
        model="gpt-6.1-sol",
        api_key="test-not-a-real-key",
        base_url="https://example.invalid/v1",
        max_tokens=8192,
        temperature=1,
        top_p=0.9,
        http_client=sync,
        http_async_client=asynchronous,
    )
    configured = configure_chat_model(original, effort)
    assert configured.invoke("hello").content == "OK"
    body = json.loads(requests[0].content)
    assert body["reasoning_effort"] == effort
    assert body["max_completion_tokens"] == tokens
    assert "temperature" not in body and "top_p" not in body
    assert requests[0].extensions["timeout"]["read"] == seconds
    assert configured.root_client.max_retries == 0
    assert configured.root_async_client.max_retries == 0
    assert original.root_client.max_retries != 0
    assert original.temperature == 1 and original.top_p == 0.9


def test_reasoning_no_automatic_retry():
    calls = []

    def fail(request):
        calls.append(request)
        return httpx.Response(500, json={"error": {"message": "offline test"}})

    model = ChatOpenAI(
        model="gpt-6.1-sol",
        api_key="test-not-a-real-key",
        base_url="https://example.invalid/v1",
        http_client=httpx.Client(transport=httpx.MockTransport(fail)),
    )
    with pytest.raises(Exception):
        configure_chat_model(model, "high").invoke("hello")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_reasoning_rejects_unknown_and_ultra():
    assert supported_reasoning_efforts("openai", "gpt-6.1-sol") == [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    ]
    assert not supported_reasoning_efforts("other", "gpt-6.1-sol")
    with patch("open_notebook.ai.models.Model.get", new=AsyncMock()) as get_model:
        get_model.return_value = SimpleNamespace(provider="openai", name="gpt-6.1-sol")
        await validate_reasoning_effort("model:1", "max")
        with pytest.raises(ConfigurationError, match="not supported"):
            await validate_reasoning_effort("model:1", "ultra")


def test_reader_assistant_does_not_load_full_source():
    from open_notebook.graphs.source_chat import call_model_with_source_context

    llm = MagicMock()
    llm.invoke.return_value = AIMessage(content="translation")
    with (
        patch(
            "open_notebook.graphs.source_chat.build_source_context", new=AsyncMock()
        ) as context,
        patch(
            "open_notebook.graphs.source_chat.provision_langchain_model",
            new=AsyncMock(return_value=llm),
        ),
    ):
        result = call_model_with_source_context(
            {
                "source_id": "source:test",
                "purpose": "reader_assistant",
                "messages": [HumanMessage(content="selected text")],
            },
            {"configurable": {}},
        )
    context.assert_not_awaited()
    assert result["messages"].content == "translation"
    assert result["context_indicators"]["sources"] == []
    prompt = llm.invoke.call_args.args[0]
    assert "selected text" in prompt[-1].content


def test_concurrent_turn_on_same_session_is_rejected():
    entered, release = threading.Event(), threading.Event()

    class SlowGraph:
        def invoke(self, **_kwargs):
            entered.set()
            assert release.wait(5)
            return {"ok": True}

    graph = SlowGraph()
    config = {"configurable": {"thread_id": "test-reader-lock"}}
    msg = HumanMessage(content="hello", id="1")
    thread = threading.Thread(target=invoke_chat_turn, args=(graph, {}, config, msg))
    thread.start()
    try:
        assert entered.wait(5)
        with pytest.raises(RateLimitError):
            invoke_chat_turn(graph, {}, config, msg)
    finally:
        release.set()
        thread.join(5)
    assert not thread.is_alive()
