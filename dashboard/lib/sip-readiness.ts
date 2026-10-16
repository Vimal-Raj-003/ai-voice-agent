// Pure decision logic for the telephony preflight check.
//
// Kept free of imports so it can be unit-tested directly, and so the rule
// "which source of truth decides SIP readiness" lives in one readable place.
//
// WHY THIS EXISTS: agent.py dials with
//   create_sip_participant(sip_trunk_id=config.OUTBOUND_TRUNK_ID, ...)
// That value is an environment setting owned by the voice service. The dial
// path never reads the `sip_trunks` or `phone_numbers` tables. Those tables
// are empty on this install, so a DB-only check reported "SIP not configured"
// on a system that had already placed real calls, and blocked Run now for a
// campaign that was genuinely dialable.

export type SipState = "ok" | "fail" | "pending";

export type SipInput = {
  /** Active rows in the optional DB-backed config. */
  trunkRows: number;
  numberRows: number;
  /** OUTBOUND_TRUNK_ID reported configured by the voice service. */
  trunkConfigured: boolean | null;
  /** VOBIZ_OUTBOUND_NUMBER reported configured by the voice service. */
  numberConfigured: boolean | null;
  /** True when the voice service could not be reached at all. */
  probeFailed: boolean;
};

export type SipDecision = { state: SipState; detail: string };

export function decideSipCheck(i: SipInput): SipDecision {
  // 1. Explicit DB-backed config wins when an install actually uses it.
  if (i.trunkRows > 0 && i.numberRows > 0) {
    return {
      state: "ok",
      detail:
        `${i.trunkRows} active trunk${i.trunkRows === 1 ? "" : "s"}, ` +
        `${i.numberRows} number${i.numberRows === 1 ? "" : "s"}`,
    };
  }

  // 2. Otherwise the voice service's own config is authoritative, because that
  //    is what the dialer uses.
  if (i.probeFailed) {
    return {
      state: "pending",
      detail: "could not reach the voice service to verify telephony configuration",
    };
  }
  if (i.trunkConfigured === true) {
    return {
      state: "ok",
      detail: i.numberConfigured === true
        ? "outbound trunk and caller number configured on the voice service"
        : "outbound trunk configured on the voice service",
    };
  }
  if (i.trunkConfigured === false) {
    return {
      state: "fail",
      detail: "no outbound SIP trunk is configured (set OUTBOUND_TRUNK_ID on the voice service)",
    };
  }
  // Reached the service but it did not report the key at all.
  return {
    state: "pending",
    detail: "the voice service did not report its telephony configuration",
  };
}
