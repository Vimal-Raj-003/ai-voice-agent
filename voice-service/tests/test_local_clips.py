"""Local clip resolver (local_clips.py) — same-language-only, graceful absence."""

import local_clips as lc


def _touch(d, name):
    p = d / name
    p.write_bytes(b"RIFF....WAVEfmt ")  # content irrelevant to the resolver
    return str(p)


def test_base_lang_normalization():
    assert lc._base_lang("ta-IN") == "ta"
    assert lc._base_lang("Tamil") == "ta"
    assert lc._base_lang("en-US") == "en"
    assert lc._base_lang("auto") == ""
    assert lc._base_lang(None) == ""


def test_clip_path_found(tmp_path):
    _touch(tmp_path, "ta_presence.wav")
    assert lc.clip_path("ta", "presence", str(tmp_path)) is not None
    assert lc.clip_path("ta-IN", "presence", str(tmp_path)) is not None


def test_clip_path_missing_returns_none(tmp_path):
    assert lc.clip_path("ta", "filler", str(tmp_path)) is None


def test_never_cross_language(tmp_path):
    # Only an English clip exists; a Tamil call must NOT get it.
    _touch(tmp_path, "en_presence.wav")
    assert lc.clip_path("en", "presence", str(tmp_path)) is not None
    assert lc.clip_path("ta", "presence", str(tmp_path)) is None


def test_unknown_kind_or_lang(tmp_path):
    _touch(tmp_path, "ta_presence.wav")
    assert lc.clip_path("ta", "bogus", str(tmp_path)) is None
    assert lc.clip_path("", "presence", str(tmp_path)) is None


def test_available_map(tmp_path):
    _touch(tmp_path, "ta_presence.wav")
    _touch(tmp_path, "ta_filler.wav")
    _touch(tmp_path, "en_unavailable.wav")
    _touch(tmp_path, "notes.txt")          # ignored
    avail = lc.available(str(tmp_path))
    assert avail["ta"] == ["filler", "presence"]
    assert avail["en"] == ["unavailable"]
