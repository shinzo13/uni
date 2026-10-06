# uni

Aggregator that unifies university data providers into one app: schedule, assignments, announcements/notifications from teachers, grades, and anything else the providers expose.

## Providers

- **USOS** (UAM instance, usosapps.amu.edu.pl) — schedule, courses, grades. Has USOS API (OAuth 1.0a) and an iCal timetable feed.
- **Moodle** — assignments, course materials, announcements. Web services REST API (token-based).
- **Microsoft Teams** — announcements, assignments, meetings. Microsoft Graph API (OAuth 2.0 / MSAL).

Each provider is an adapter that maps its data into shared domain models; the rest of the system never depends on a specific provider.

## Stack

- `backend/` — Python
- `mobile/` — React Native

## Conventions

- Everything in the repo is English only: code, strings, READMEs, commits. No Russian or Polish.
- No comments in code; code must be self-explanatory. No docstrings unless explicitly requested.
- Commits: one-line Conventional Commits, lowercase (`feat(backend): ...`), no body, authored by the user, no Co-Authored-By trailer.
- After each module, give the user a short summary: the implementation approach and which classes exist and why.
- Never commit credentials, tokens, or personal feed URLs.
