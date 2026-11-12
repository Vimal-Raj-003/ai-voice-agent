"""Execute the actual browser error callback; no provider or room connection."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock


def browser_error_callback(runtime, emit, stopped):
    tree=ast.parse(Path('gemini_live_runtime.py').read_text(encoding='utf-8'))
    run=next(n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='run_browser_test')
    callback=next(n for n in ast.walk(run) if isinstance(n,ast.FunctionDef) and n.name=='session_error')
    factory=ast.parse('def make(runtime, emit, stopped):\n failed=False\n def get_failed(): return failed\n return session_error,get_failed').body[0]
    factory.body.insert(2,callback)
    module=ast.fix_missing_locations(ast.Module(body=[factory],type_ignores=[]))
    scope={};exec(compile(module,'gemini_live_runtime.py','exec'),scope)
    return scope['make'](runtime,emit,stopped)


def test_sdk_recovery_does_not_immediately_end_the_browser_demo():
    stopped=asyncio.Event();emit=Mock()
    runtime=NS(state=NS(intelligence=NS(recovering=True)))
    callback,failed=browser_error_callback(runtime,emit,stopped)
    callback(NS(error=NS(recoverable=True)))
    assert not stopped.is_set(), 'Browser handler canceled the SDK recovery'
    assert not failed()


def test_terminal_provider_error_still_ends_browser_demo():
    stopped=asyncio.Event();emit=Mock()
    runtime=NS(state=NS(intelligence=NS(recovering=False)))
    callback,failed=browser_error_callback(runtime,emit,stopped)
    callback(NS(error=NS(recoverable=False)))
    assert stopped.is_set() and failed()
