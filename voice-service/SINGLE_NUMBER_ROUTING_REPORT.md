# Single-number routing — 03 November 2026

> Number routing remains unchanged. The worker was subsequently updated to v12; see [current worker readiness and conversation verification](EMAIL_DIRECTION_REPAIR_REPORT.md).

**Current number: +91 8065481576 for inbound and outbound.** Dial **08065481576** within India. Provider configuration read-backs and local worker readiness pass. An actual inbound/outbound phone call has **not** been tested after this change.

## கண்டுபிடித்த issues

1. **Requested number was routed to another application.** Vobiz showed `+918065481576` as active and not blocked, but assigned to **Vobiz WebRTC Playground**, application `97468014913938513`, answer URL `https://rtc-demo.vobiz.ai/api/answer`. It had no SIP trunk assignment. This is a verified routing fault: that number was not entering the JillJill SIP path. The exact SIP response behind the caller's busy announcement was not captured, so an actual busy agent is not established.
2. **Old number held the working inbound route.** `+918065480036` was assigned to carrier trunk `dcb49c8b-2e62-436c-b2db-bd41db884e40`, whose enabled origination URI points to `2v51wvltnsk.sip.livekit.cloud`.
3. **Outbound caller ID still used the old number.** Both the local outbound-number setting and the LiveKit outbound trunk listed `+918065480036`.
4. **Dashboard inbound-trunk setting used the wrong kind of ID.** Its `INBOUND_TRUNK_ID` held the Vobiz outbound trunk UUID instead of the LiveKit inbound trunk ID. The worker environment already had the correct LiveKit ID; this inconsistency alone is not proven to have caused the failed inbound call.
5. **Two active app mappings made the intended number unclear.** Both numbers mapped to the same assistant. They were not separate versions of the repair.

## Applied configuration

| Layer | Current verified value |
| --- | --- |
| Vobiz target number | `+918065481576`, active, not blocked, application association removed |
| Vobiz inbound trunk | `dcb49c8b-2e62-436c-b2db-bd41db884e40`, target number assigned |
| LiveKit inbound trunk | `ST_mKsscodyJixr`; only target aliases: `+918065481576`, `918065481576`, `08065481576`, `8065481576` |
| LiveKit outbound trunk | `ST_reLomjZWYvH3`; caller-number list only `+918065481576` |
| Outbound SIP destination | Existing `f300ac94.sip.vobiz.ai`; transport and credentials preserved |
| App/settings/local `.env` | `VOBIZ_OUTBOUND_NUMBER=+918065481576`, inbound `ST_mKsscodyJixr`, outbound `ST_reLomjZWYvH3` |
| Selected assistant | Existing `cmuv65lxx0013v7f4thzf2qtv` |
| Old number | App mapping inactive; removed from carrier and LiveKit routing; call history retained |

**Old number ownership has not been released/unrented at Vobiz.** Its carrier inventory status remains active, with no application or SIP trunk assignment. Routing removal does not establish that number rental charges have stopped. No phone number was purchased, no application was deleted, and no credentials were changed.

Only the number's association with Playground was removed; the Playground application itself was not deleted. Existing SIP trunks, dispatch, ACLs, assistant, BYOK, recordings and voice repairs were preserved. This task changed routing and helper scripts, not the conversation architecture.

## Readiness and limits

| Verification | Result and evidence |
| --- | --- |
| Carrier assignment and old-number removal | Work ஆகுது — actual API read-back in [migration](output/verify/single-number-migration.json) |
| LiveKit number lists, DB mappings/settings, local outbound number | Work ஆகுது — [after audit](output/verify/single-number-audit.json) and [readiness checks](output/verify/single-number-readiness.json) |
| Worker | Work ஆகுது — build `2026-11-03-conversation-v11`, root PID `5840`; fresh registration `AW_R8NFCtUYwFoQ` at **17:07:07 IST**, India South, SDK `1.8.4`; health HTTP 200 |
| Dashboard and backend | Work ஆகுது — `http://localhost:3000/login` and `http://localhost:8000/health` HTTP 200 after worker restart |
| Inbound phone ring / connected conversation | Test பண்ணலை — user must call `08065481576`; configuration success is not handset proof |
| Outbound carrier acceptance / displayed caller ID | Test பண்ணலை — caller ID configured, no outbound call initiated |
| One-second meaningful voice / handset interruption timing | Test பண்ணலை in this routing task; previous measured voice results do not establish one-second latency |

Only the worker was restarted, gracefully, with no active jobs before restart. Its inherited `VOBIZ_OUTBOUND_NUMBER` is verified as the target. One root worker is running; SDK prewarm children are not duplicate registered roots. Existing flags remain `VOICE_TEST_READ_ONLY=true`, `VOICE_PREEMPTIVE_GENERATION=true`, `VOICE_STRICT_LANGUAGE_LOCK=true`, useful-text timeout `4.5 s`, stream-idle timeout `4.0 s`.

**Phone test limitation:** real SIP/STT/LLM/TTS remain in use, but existing read-only business-action mode remains enabled. Booking/calendar/email/SMS/business writes are unavailable; call logging and recordings remain enabled. No customer call or message was initiated. No new LLM requests were made for this routing task.

## Conversation report issues

The supplied 15:54 recording/report separately identified false booking/email success claims, invalid name capture, lost website/negative-requirement context, unwanted titles, time/email correction errors, missed presence checks, invalid boolean tool arguments, language drift, unrelated intake replies, model timeouts and model-to-audio delay. These are distinct from a call failing to enter SIP. Their prior repairs and measured limits are documented in [VOICE_CALL_1554_REPAIR.md](VOICE_CALL_1554_REPAIR.md); the original evidence remains in [VOICE_CALL_1554_ANALYSIS.md](VOICE_CALL_1554_ANALYSIS.md). This number migration does not prove all conversation failures are resolved on a real phone call.

## Reproducible evidence

- [Before app/LiveKit/settings snapshot](output/verify/single-number-audit-before.json)
- [Before Vobiz snapshot](output/verify/single-number-vobiz.json)
- [Attached Playground application read-back](output/verify/vobiz-routing-api-inspection.log)
- [Applied migration and final carrier read-back](output/verify/single-number-migration.json)
- [After app/LiveKit/settings snapshot](output/verify/single-number-audit.json)
- [Runtime readiness assertions](output/verify/single-number-readiness.json)
- [Fresh worker restart/build metadata](output/verify/conversation-v11-restart.json), [worker log](output/verify/conversation-v11-worker.log)
- Read-only verification: `scripts/verify_single_number_readiness.py`. It uses saved provider read-backs, current worker process environment and localhost health; it does not place calls.

The official Vobiz provisioning implementation distinguishes unlinking an application association, assigning/unassigning a trunk, and releasing number ownership: [Vobiz provisioning source](https://github.com/vobiz-ai/Vobiz-MCP-Server/blob/main/src/tools/provisioning.ts). Only association and trunk-routing operations were used here.
