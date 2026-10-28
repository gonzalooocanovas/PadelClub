# Stage 0 baseline (before this overhaul)

- Repository HEAD: `f68de65`. Node `v24.19.0`, Windows 11, Intel i7-1255U (12 threads), 17 GB RAM.
- Command: `npm test` (= `node --test "test/**/*.test.js"`). Result: **124 tests, 124 pass, 0 fail, 17.0 s**.
- Documentation drift found: `CHATGPT_BRIEFING.md` said 123 tests; `DEV_CHECKLIST.md` carried older counts (56, 84, 97, ...). They are reconciled in the final documentation pass (see `DEV_CHECKLIST.md` header).
- No benchmark scripts existed in the repository (earlier analysis scripts were throw-away). Added in this overhaul: `tools/calibrate.mjs`, `tools/bench-bots.mjs`, `tools/lib/*`.
- Reusable diagnostics found: `predictBall`, `simulateShot`, `botInput`; the harness builds on them.
