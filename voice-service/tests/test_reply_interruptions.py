import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import asyncio
import pytest


@pytest.mark.asyncio
async def test_new_reply_never_temporarily_blocks_caller_corrections():
    tree = ast.parse(Path(__file__).parents[1].joinpath("agent.py").read_text(encoding="utf-8"))
    callback = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_dbg_speech_created")
    callback.decorator_list = []
    module = ast.Module(body=[callback], type_ignores=[])
    scope = {"Any": object, "logger": Mock(), "_dbg_rid": "test-room", "asyncio": asyncio}
    exec(compile(module, "agent.py", "exec"), scope)
    handle = SimpleNamespace(allow_interruptions=True)
    scope["_dbg_speech_created"](SimpleNamespace(source="generate_reply", speech_handle=handle))
    assert handle.allow_interruptions is True
