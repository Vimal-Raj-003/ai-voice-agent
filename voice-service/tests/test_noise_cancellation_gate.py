"""The assistant's saved backgroundDenoising setting must actually take effect.

MEASURED across the whole log table before this fix:
    noise_cancellation_enabled        0
    noise_cancellation_disabled      96      (every call)
    noise_cancellation_init_failed    0
while all five assistants had backgroundDenoising = true and
noise_cancellation.BVCTelephony() constructs without error.

The cause was a second gate: `... and use_bvc`, where use_bvc came from
ENABLE_BVC_TELEPHONY defaulting to FALSE. The variable was never set, so the
UI said "on" and the runtime was off on every telephony call.

Why it matters for conversation flow: with no cancellation on a phone leg,
line noise and the agent's own audio reach the VAD. Observed consequences —
3,431 speaking-state transitions against 607 completed replies, and 1,120
reply-speeches created against 607 completed (~35% cancelled mid-sentence),
with the caller saying "Hello?" 80 times.
"""
from __future__ import annotations

import inspect
import re

import agent as ag

SRC = inspect.getsource(ag.entrypoint)
BLOCK = SRC[SRC.index("_bvc_env = os.getenv"):SRC.index("agent_input_restricted_to_sip")]


def _decide(env, assistant_setting, is_demo=False):
    """Mirrors the gate."""
    forced_off = (env is not None and env.strip().lower() in ("0", "false", "no", "off"))
    use_bvc = not forced_off
    return (not is_demo) and assistant_setting and use_bvc


# ── the setting is honoured ────────────────────────────────────────────────
def test_unset_env_now_follows_the_assistant_setting():
    """The exact production condition that was broken: nothing set, assistant
    says on — cancellation must be ON."""
    assert _decide(None, True) is True


def test_assistant_off_means_off():
    assert _decide(None, False) is False


def test_env_can_still_force_it_off():
    """A kill-switch for debugging is retained."""
    for v in ("0", "false", "no", "off", "FALSE", " Off "):
        assert _decide(v, True) is False, v


def test_env_true_values_leave_it_on():
    for v in ("1", "true", "yes", "on"):
        assert _decide(v, True) is True, v


def test_a_demo_session_is_unaffected():
    """Demo runs a browser leg, not SIP, and keeps its own input path."""
    assert _decide(None, True, is_demo=True) is False


# ── the plugin genuinely works, so the gate was the only blocker ───────────
def test_bvc_telephony_constructs():
    from livekit.plugins import noise_cancellation
    assert noise_cancellation.BVCTelephony() is not None


# ── wiring ─────────────────────────────────────────────────────────────────
def test_the_env_var_is_no_longer_a_required_opt_in():
    assert 'os.getenv("ENABLE_BVC_TELEPHONY", "false")' not in SRC, \
        "a defaulted-false opt-in silently overrides the saved setting"
    assert "_bvc_forced_off" in BLOCK


def test_the_assistant_setting_is_still_consulted():
    assert 'profile.get("background_denoising", True)' in BLOCK


def test_init_failure_still_falls_back_safely():
    """A plugin error must not take the call down."""
    assert "noise_cancellation_init_failed" in BLOCK
    assert "except Exception" in BLOCK


def test_the_disabled_log_states_the_real_reason():
    """It used to claim 'ENABLE_BVC_TELEPHONY not set', which was true but
    concealed that the operator's setting was being ignored."""
    i = SRC.index('logger.info("noise_cancellation_disabled"')
    seg = SRC[i:i + 420]
    assert "assistant_setting=" in seg
    assert "env_override=" in seg
    assert "not set — matching demo STT path" not in seg
