"""Upgrade all 9 JillJill assistants with deep domain dummy data, dynamic {business_name},
and natural everyday multilingual support (English, Tamil, Telugu, Kannada, Malayalam, Hindi).

Preserves every voiceRuntime, model, voice, tool, speechReference, and telephony setting.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

# Support running against either local voice-service/.env or the shared checkout .env
for env_candidate in (
    ROOT / ".env",
    Path(r"c:\Users\CT\Voice Agent\ai-voice-agent\voice-service\.env"),
):
    if env_candidate.exists():
        load_dotenv(env_candidate)
        break

import db  # noqa: E402
from assistant_presets import ROLES, greeting, role_prompt  # noqa: E402

ASSISTANT_TARGETS = [
    {
        "id": "cmuv4xd8i0011v7f4fgsgfr5x",
        "role": "receptionist",
        "default_business": "Vims Enterprises",
        "pronunciation_note": True,
    },
    {
        "id": "cmuv65lxx0013v7f4thzf2qtv",
        "role": "appointment",
        "default_business": "Vims Enterprises",
        "pronunciation_note": True,
    },
    {
        "id": "cmuv6fea90015v7f4fexyfx8g",
        "role": "sales",
        "default_business": "Vims Enterprises",
        "pronunciation_note": True,
    },
    {
        "id": "cmuv6w9d70017v7f4j8kth708",
        "role": "support",
        "default_business": "Vims Enterprises",
        "pronunciation_note": True,
    },
    {
        "id": "cmuv75n1j0019v7f434t6xj6q",
        "role": "marketing",
        "default_business": "Vims Enterprises",
        "pronunciation_note": True,
    },
    {
        "id": "cmvxs7rk10001v7e8kcdra9ez",
        "role": "hospital",
        "default_business": "Sunrise Multi-Speciality Hospital",
        "pronunciation_note": False,
    },
    {
        "id": "c40c4a0181bf251ca929f0706",
        "role": "ivr",
        "default_business": "Vims Enterprises",
        "pronunciation_note": True,
    },
    {
        "id": "ccc6c12cc5f975d64b659ec72",
        "role": "clinic",
        "default_business": "CarePlus Family & Dental Clinic",
        "pronunciation_note": False,
    },
    {
        "id": "caaad76e39781563d9ee13de0",
        "role": "academy",
        "default_business": "Excel Career & Coaching Academy",
        "pronunciation_note": False,
    },
]

VIMS_PRONUNCIATION = (
    "\n\nPRONUNCIATION NOTE: When speaking 'Vims Enterprises', pronounce 'Vims' smoothly as one word (rhyming with rims), "
    "never as separate letters V-I-M-S or V-M-S."
)


async def upgrade_all(backup_path: Path | None = None) -> list[dict]:
    pool = await db.get_pool()
    summary: list[dict] = []
    try:
        async with pool.acquire() as conn, conn.transaction():
            existing_rows = await conn.fetch('SELECT * FROM assistants ORDER BY "createdAt" ASC FOR UPDATE')
            if backup_path is not None and not backup_path.exists():
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                backup_path.write_text(
                    json.dumps([dict(r) for r in existing_rows], ensure_ascii=False, default=str, indent=2),
                    encoding="utf-8",
                )

            by_id = {r["id"]: dict(r) for r in existing_rows}
            for item in ASSISTANT_TARGETS:
                aid = item["id"]
                role = item["role"]
                if aid not in by_id:
                    continue
                before = by_id[aid]
                meta = before["metadata"]
                if isinstance(meta, str):
                    meta = json.loads(meta)
                meta = dict(meta or {})

                inbound = role_prompt(role, "INBOUND")
                outbound = role_prompt(role, "OUTBOUND")
                if item["pronunciation_note"]:
                    inbound += VIMS_PRONUNCIATION
                    outbound += VIMS_PRONUNCIATION

                first_msg = greeting(role)
                description = ROLES[role][2]

                meta["roleKey"] = role
                meta["businessName"] = item["default_business"]
                meta["setupRequired"] = False
                meta["promptRevision"] = "multilingual-domain-v42"
                meta["directionPrompts"] = {
                    **(meta.get("directionPrompts") or {}),
                    "outbound": outbound,
                }
                # Enable full CallIntelligence pillars consistently across all 9 stations
                meta["intelligence"] = {
                    "memory": True,
                    "emotion": True,
                    "quality": True,
                    "outcomes": True,
                    "recovery": True,
                    "self_correction": True,
                    **(meta.get("intelligence") or {}),
                }

                await conn.execute(
                    '''UPDATE assistants
                          SET description = $1,
                              "firstMessage" = $2,
                              "systemPrompt" = $3,
                              metadata = $4::jsonb,
                              "updatedAt" = NOW()
                        WHERE id = $5''',
                    description,
                    first_msg,
                    inbound,
                    json.dumps(meta, ensure_ascii=False),
                    aid,
                )

                after = dict(await conn.fetchrow("SELECT * FROM assistants WHERE id = $1", aid))
                preserved_cols = [
                    k
                    for k in before
                    if k not in ("description", "firstMessage", "systemPrompt", "metadata", "updatedAt")
                ]
                assert all(before[k] == after[k] for k in preserved_cols), f"Unexpected column mutation on {aid}"
                summary.append(
                    {
                        "id": aid,
                        "name": after["name"],
                        "role": role,
                        "default_business": item["default_business"],
                        "firstMessage": after["firstMessage"],
                        "prompt_chars": len(after["systemPrompt"] or ""),
                        "voiceRuntime": meta.get("voiceRuntime"),
                    }
                )
        return summary
    finally:
        await db.close_pool()


if __name__ == "__main__":
    default_backup = Path(
        r"C:\Users\CT\.gemini\antigravity\brain\19d1aace-e47c-4003-ba90-131cb1d11bc2\scratch\assistants_backup_before_upgrade.json"
    )
    res = asyncio.run(upgrade_all(default_backup))
    print(json.dumps(res, ensure_ascii=False, indent=2))
