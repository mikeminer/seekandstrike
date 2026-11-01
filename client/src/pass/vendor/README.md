# Vendored Daily Pass evaluator

`season-pass.mjs` and `timelock-gate.mjs` are copied **byte-for-byte unchanged** from the owner's
DevFridge Game Builder skill (`assets/`), as that skill requires ("use the Season Pass helper with the
unchanged evidence/freshness helper"). They are pure policy functions: no RPC, no wallet, no I/O.

Do not edit them. Our own code (`../validity.ts`) feeds them evidence produced by the trusted
on-chain verifier (`../reader.ts`) and adds the receipt rule documented in docs/brief.md §9.5.
