"""CLI test harness — dispatch a single outbound call locally."""

import argparse
import asyncio
import json
import os
import random

from dotenv import load_dotenv
from livekit import api

load_dotenv(".env")


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--to", required=True, help="Phone number e.g. +919999999999")
    p.add_argument("--lead-name", default="there")
    p.add_argument("--business-name", default="our company")
    p.add_argument("--service-type", default="our service")
    p.add_argument("--profile-id", default=None)
    args = p.parse_args()

    if not args.to.startswith("+"):
        print("Phone must start with + and country code")
        return

    url = os.environ["LIVEKIT_URL"]
    key = os.environ["LIVEKIT_API_KEY"]
    secret = os.environ["LIVEKIT_API_SECRET"]
    lk = api.LiveKitAPI(url=url, api_key=key, api_secret=secret)
    try:
        room = f"call-{args.to.replace('+','')}-{random.randint(1000,9999)}"
        d = await lk.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(
                agent_name="voice-agent",
                room=room,
                metadata=json.dumps({
                    "phone_number": args.to, "lead_name": args.lead_name,
                    "business_name": args.business_name, "service_type": args.service_type,
                    "agent_profile_id": args.profile_id,
                }),
            ),
        )
        print(f"Dispatched. Room={room} ID={d.id}")
    finally:
        await lk.aclose()


if __name__ == "__main__":
    asyncio.run(main())
