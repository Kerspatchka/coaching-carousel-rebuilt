# AGENTS.md

At the start of each session:

1. Read `docs/ROADMAP.md`, then read all project research documentation starting at `docs/research/README.md` before making changes.
2. Review the relevant existing code instead of relying on prior-session memory.

When a task is complete:

1. Summarize what changed, key decisions, unresolved issues, and next steps.

Keep project documentation updated when changes make it inaccurate.
Review and maintain `docs/ROADMAP.md` whenever work changes milestone status, validated capabilities, product constraints, key decisions, open issues, or next priorities.

After every save experiment is prepared or evaluated:

1. Update the detailed research document with the experiment ID, treatment, validation status, artifact/report paths, result, and implementation consequence.
2. Add or update a concise experiment summary in `docs/ROADMAP.md`, including its stable experiment ID, current status, primary learning, and links to the detailed research and machine-readable evidence.
3. Associate every new validated capability, rejected assumption, or product constraint with the experiment that established it. Keep forensic detail in `docs/research/` and avoid duplicating the full report in the roadmap.

For human-operated save experiments, default to one validated treatment save and reuse existing reference fixtures for comparison. Do not prepare control and serializer-sham arms unless they are essential to isolate an otherwise unanswerable mutation axis and the added human effort has been discussed with the user.

## EA Sports College Football 27 game interaction

- Codex must not interact with or automate the EA Sports College Football 27 game UI.
- Rely on human-in-the-loop interaction for advancing weeks and all other in-game activities.
- Codex may prepare, copy, parse, compare, and validate save files outside the game, then provide the human operator with explicit in-game steps.
- After human-operated game steps, Codex may resume analysis when the resulting saves are available and the user confirms completion.
