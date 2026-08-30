# Project workflow

- Read `HANDOFF.md` at the start of a new session before choosing the next action.
- Use the Mat Pocock skills for project work. Start with `wayfinder` when continuing the existing map or charting a large, uncertain effort, then use the skills named in the map.
- When project instructions require a skill, locate its `SKILL.md`, read it, and use it in every specified case even if the skill is missing from the session's advertised catalog. Search installed skill and plugin directories before concluding that it cannot be used.
- Treat skills from the `superpowers` family as disabled in this repository.
- The issue tracker is local Markdown under `.scratch/`. Read `docs/agents/issue-tracker.md` for Wayfinder operations.
- Ask the user no more than one question per message.
- Before any e2e or integration test, verify the actual backend/API target. If it is production, non-local, or not an isolated test environment, warn the user and wait for explicit permission before running the test.
