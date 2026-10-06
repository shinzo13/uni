# uni

Aggregator that unifies university data sources into one app: schedule, assignments, announcements/notifications from teachers, grades, and anything else the sources expose.

## Sources

- **USOS** (UAM instance, usosapps.amu.edu.pl) — schedule, courses, grades. Has USOS API (OAuth 1.0a) and an iCal timetable feed.
- **Moodle** — assignments, course materials, announcements. Web services REST API (token-based).
- **Microsoft Teams** — announcements, assignments, meetings. Microsoft Graph API (OAuth 2.0 / MSAL).

Each source is an adapter that maps its data into shared domain models; the rest of the system never depends on a specific source. Always call them "sources", never "providers". API findings: `docs/sources.md`.

## Product

User accounts on the backend keep linked sources, so a user connects each source once.

App tabs:

1. Schedule: timetable plus academic calendar (breaks, exam sessions). USOS.
2. Assignments: current and archive. Moodle + Teams.
3. Courses: materials and pages, mostly Moodle, plus Teams channel posts.
4. Grades: per course, combined from USOS, Moodle and Teams.

## Stack

- `backend/` — Python
- `mobile/` — React Native

## Conventions

- Everything in the repo is English only: code, strings, READMEs, commits. No Russian or Polish.
- No comments in code; code must be self-explanatory. No docstrings unless explicitly requested.
- Commits: one-line Conventional Commits, lowercase (`feat(backend): ...`), no body, authored by the user, no Co-Authored-By trailer.
- After each module, give the user a short summary: the implementation approach and which classes exist and why.
- Never commit credentials, tokens, or personal feed URLs.
