# Audits

Retrospective analyses of the codebase against a specific concern (AI-readiness, security, accessibility, etc.). Each audit is a point-in-time snapshot with `file_path:line_number` references.

Audits are complementary to specs (`../specs/`) and plans (`../plans/`):
- **Specs** describe what we're about to build.
- **Plans** describe how we'll build it.
- **Audits** describe what already exists and where the gaps are.

Each audit filename follows the pattern `YYYY-MM-DD-<topic>-audit.md` and references the git commit SHA it was run against.
