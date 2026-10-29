"""Native reasoning controls for interactive chat; no prompt-based emulation."""

from typing import Literal, Optional

from langchain_core.language_models.chat_models import BaseChatModel

from open_notebook.exceptions import ConfigurationError, NotFoundError

ReasoningEffort = Literal["low", "medium", "high", "xhigh", "max", "ultra"]
SessionPurpose = Literal["main", "reader_assistant"]


def supported_reasoning_efforts(provider: str, name: str) -> list[str]:
    # Verified against the official model docs, 2026-10-29. A custom endpoint
    # must still implement the native OpenAI protocol; provider errors surface.
    if provider == "openai" and name in {"gpt-6.1-sol", "gpt-6.1-terra"}:
        return ["low", "medium", "high", "xhigh", "max"]
    return []


async def validate_reasoning_effort(
    model_id: Optional[str], effort: Optional[str]
) -> None:
    if effort is None:
        return  # Existing sessions retain their provider's native default.
    from open_notebook.ai.models import DefaultModels, Model

    if not model_id:
        model_id = (await DefaultModels.get_instance()).default_chat_model
    if not model_id:
        raise ConfigurationError("Configure a chat model before selecting reasoning")
    try:
        model = await Model.get(model_id)
    except NotFoundError as exc:
        raise ConfigurationError("The selected chat model no longer exists") from exc
    if effort not in supported_reasoning_efforts(model.provider, model.name):
        raise ConfigurationError(
            f"Reasoning '{effort}' is not supported by {model.provider}/{model.name}. "
            "Choose a supported level or the model default."
        )


def configure_chat_model(model: BaseChatModel, effort: Optional[str]) -> BaseChatModel:
    """Copy per-call options AND SDK clients without mutating shared clients."""
    from langchain_openai import ChatOpenAI

    if not isinstance(model, ChatOpenAI):
        if effort is not None:
            raise ConfigurationError("This provider has no native reasoning adapter")
        return model

    tokens, seconds = (
        (32768, 540) if effort in {"high", "xhigh", "max"} else (8192, 180)
    )
    # model_copy alone does not reinitialize the SDK clients (and would leave
    # OpenAI's default retries active). Clones share the existing HTTP transport;
    # don't close them independently of the provisioned model.
    sync_root = model.root_client.with_options(max_retries=0, timeout=seconds)
    async_root = model.root_async_client.with_options(max_retries=0, timeout=seconds)
    options = {
        "root_client": sync_root,
        "client": sync_root.chat.completions,
        "root_async_client": async_root,
        "async_client": async_root.chat.completions,
        "request_timeout": seconds,
        "max_retries": 0,
        "max_tokens": tokens,
    }
    if effort is not None:
        options.update(reasoning_effort=effort, temperature=None, top_p=None)
    return model.model_copy(update=options)
