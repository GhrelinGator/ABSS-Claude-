# Status

Update this at the end of every session. Newest information at the top of each section.

## Current state

- **Phase:** planning complete. Phase 0 not started. No code exists.
- **Next action:** Phase 0.1 [F]: architecture skeleton (see `ROADMAP.md`).
- **Blocked on:** nothing for Phase 0. The owner decisions below are needed before the phases noted.

## Decisions needed from the owner

| # | Question | Needed by | Default if undecided |
|---|---|---|---|
| Q1 | **Player role:** observer, god (interventions as physical events), one agent among many, or a mix? | Phase 9 (affects viewer design from Phase 1) | Observer |
| Q2 | **Confirm the stack:** TypeScript (Node + browser), with Rust/WASM only if benchmarks demand it (D-007). | Phase 0.1 | TypeScript |
| Q3 | **Where long runs execute.** Evolutionary runs take hours. Cloud sessions stop background processes a few minutes after a reply ends, so overnight batches need the owner's computer (or another machine that stays on). | Phase 3 | Owner's computer |
| Q4 | **Viewer hosting:** standalone page, or alongside the owner's other web games? | Phase 1.9 | Standalone |
| Q5 | **Project name.** "ABSS" (agent-based social simulation) is a placeholder. | Anytime | ABSS |

## Known risks

- **Compute budget** (`DESIGN.md` §1.3). Rich minds × large populations × many generations may not fit. Phase 0.4 measures it.
- **Founder viability.** Blank-slate founders may die before learning enough. Viability tuning is allowed (logged), but if it takes heavy tuning, the floor may need rethinking. That's a conversation with the owner, not a quiet fix.
- **Floor 1 expressiveness** (`DESIGN.md` §6.7). The legitimation chain may be inexpressible with unordered token bags.
- **Claude's drift** (`GUARDRAILS.md`). The more sessions pass, the more tempting small nudges become.
- **Claude can't watch.** I read numbers; the owner can see behavior in the viewer. Odd behavior he notices is high-value input. Ask him what he's seen.

## Benchmarks

None yet. Phase 0.4 records them here.

## Ideas parked (not in scope until a phase claims them)

- Conquest for territory and self-sacrifice for the group (needs a higher language floor).
- Writing emerging from marks on objects ("learning from books").
- Containers (hide + fiber), which would change storage dynamics.
- LLM narration of detected events in the viewer, display-only (`GUARDRAILS.md` T12).
- God mode (`DESIGN.md` §10), if the owner wants it.

## Session log

- **2026-11-15** (Opus 5.5, claude.ai): Wrote the full plan: `CLAUDE.md`, `GUARDRAILS.md`, `DESIGN.md`, `ROADMAP.md`, `DECISIONS.md`, `RESEARCH.md`, `ORIGIN.md`, experiment template, tuning log. No code, per the owner's instruction to brainstorm and plan first.
