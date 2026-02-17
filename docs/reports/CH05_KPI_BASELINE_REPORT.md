# CH-05 KPI Baseline Report

- Report ID: `ch05-kpi-baseline-2026-02-17`
- Contract version: `autopilot-kpi-v1`
- Generated at (UTC): `2026-02-17T22:21:01.774Z`
- Window: `2026-01-18T22:21:01.774Z` -> `2026-02-17T22:21:01.774Z` (30 days)
- Signed by: `Agent_1`
- Signed at (UTC): `2026-02-17T22:21:01.774Z`
- Signature: `sha256:204bb95be52bef1abf77a72cba383f7997df891e07c0e1d20b045d850134ceab`

| Metric | Value | Sample | Status | Numerator | Denominator |
| --- | --- | --- | --- | --- | --- |
| Mastery gain per active hour (mastery_gain_per_hour) | 3528.0970 mastery_points/hour | 176 | ok | 6181.5200 | 1.7521 |
| Verified growth (verified_growth_per_100_attempts) | 52.8409 verified_transitions/100_attempts | 176 | ok | 93.0000 | 176.0000 |
| Retention pass rate (7d) (retention_pass_rate_7d) | n/a ratio_0_1 | 0 | not_available | 0.0000 | 0.0000 |
| Retention pass rate (30d) (retention_pass_rate_30d) | n/a ratio_0_1 | 0 | not_available | 0.0000 | 0.0000 |
| Retention pass rate (90d) (retention_pass_rate_90d) | n/a ratio_0_1 | 0 | not_available | 0.0000 | 0.0000 |
| OOD pass rate (ood_pass_rate) | n/a ratio_0_1 | 0 | not_available | 0.0000 | 0.0000 |
| Frustration proxy rate (frustration_proxy_rate) | 0.2541 ratio_0_1 | 181 | ok | 46.0000 | 181.0000 |
| Planner latency p95 (planner_latency_p95_ms) | 5960.0000 ms | 204 | ok | n/a | n/a |

Notes:
- retention metrics are computed on delayed direct evidence windows with a 21-day grace period.
- frustration proxy = needs_retry OR recoveryTriggered OR taskScore < 45.
- this report is machine-signed with SHA-256 over report payload + signoff metadata.

