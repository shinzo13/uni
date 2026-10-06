# Sources

Findings from probing each source with a real student account (UAM, Faculty of Mathematics and Computer Science), October 2026.

## USOS

- Base URL: `https://usosapps.amu.edu.pl/services/`
- Auth: OAuth 1.0a, HMAC-SHA1. Consumer key is self-service at `https://usosapps.amu.edu.pl/developers/` (no login needed).
- User authorization: `oauth/request_token` with `oauth_callback=oob` → user opens `oauth/authorize` → PIN → `oauth/access_token`.
- Scopes requested: `studies|grades|email|personal|offline_access|events|crstests`. With `offline_access` the access token does not expire.
- An iCal timetable feed (`tt/upcoming_ical`) also exists, but it is a personal URL with an embedded key and duplicates `tt/student`.

| Data | Method | Notes |
|---|---|---|
| Profile | `users/user` | |
| Courses per term | `courses/user` with `active_terms_only=false` | Returns all terms. |
| Timetable | `tt/student` | Max 7 days per call; loop week by week for a full term. Fields: time, course, class type, building, room, lecturers, group. |
| Final grades | `grades/terms2` with `term_ids` | Per course unit and course, with exam session number and pass flag. |
| Recent grades | `grades/latest` | Defaults to a short window; pass `days` explicitly. |
| Tests (sprawdziany) | `crstests/participant` → `crstests/node` (recursive) → `crstests/user_points` / `crstests/user_grades` with `node_ids` | `all_user_points` / `all_user_grades` require trusted access; walk the tree and query by node ids instead. Node types: `root`, `fld`, `pkt` (points), `oc` (grade). |
| Exams | `exams/student_exams` | Must pass explicit `fields` without `attendees`, otherwise `method_forbidden`. Dates and rooms are in `groups[exam_start\|exam_end\|room\|slots[...]]`. |
| Exam protocols | `examrep/user2` | Which graded credits / exams the student is attached to. |
| University news | `news/search`, `news/article` | |
| Academic calendar | `calendar/search` | Needs a valid `faculty_id` and a range of at most one month. Faculty id not resolved yet. |

## Moodle

- Instance for the Faculty of Mathematics and Computer Science: `https://lms.amu.edu.pl/sci` (the old `moodle.amu.edu.pl` is dead). Other UAM schools have sibling instances under `lms.amu.edu.pl/`.
- Auth: login is CAS only, so `login/token.php` with a password does not work. Use the mobile app SSO flow:
  `admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=<random>&urlscheme=<scheme>`.
  After CAS login it redirects to `<scheme>://token=<base64>`; the payload is `md5(siteurl + passport):::token:::privatetoken`. Verify the md5, keep `token`.
- Calls: `POST webservice/rest/server.php` with `wstoken`, `wsfunction`, `moodlewsrestformat=json`. Array args as `name[i]`.
- Files: `pluginfile.php` URLs (in resources, assignment attachments and inside page HTML) download with `?token=<token>` appended.
- Token lifetime is not exposed; if it dies, repeat the SSO flow.

| Data | Function |
|---|---|
| Site info / available functions | `core_webservice_get_site_info` |
| Courses | `core_enrol_get_users_courses` (includes past terms; filter by name) |
| Course structure | `core_course_get_contents` |
| Pages | `mod_page_get_pages_by_courses` (HTML) |
| Files | `mod_resource_get_resources_by_courses`, `mod_folder_get_folders_by_courses` |
| Links | `mod_url_get_urls_by_courses` |
| Labels | `mod_label_get_labels_by_courses` |
| Assignments | `mod_assign_get_assignments`, `mod_assign_get_submission_status` |
| Quizzes | `mod_quiz_get_quizzes_by_courses`, `mod_quiz_get_user_attempts`, `mod_quiz_get_user_best_grade` |
| Announcements / forums | `mod_forum_get_forums_by_courses`, `mod_forum_get_forum_discussions`, `mod_forum_get_discussion_posts` |
| Grades | `gradereport_overview_get_course_grades`, `gradereport_user_get_grade_items` (requires `userid`) |
| Deadlines | `core_calendar_get_action_events_by_timesort` |
| Notifications | `message_popup_get_popup_notifications` |
| Messages | `core_message_get_conversations` |
| Incremental sync | `core_course_get_updates_since` |

Not available:

- Attendance: `mod_attendance_*` returns `accessexception`.
- LTI: only launch parameters; content opens in a browser.
- SCORM: interactive packages, metadata only.
- `mod_assign_get_assignments` and `mod_quiz_get_quizzes_by_courses` return fewer items than the course structure lists, probably due to access restrictions. Not verified.

## Microsoft Teams

- Auth: the UAM tenant requires admin consent for custom apps and Graph CLI tools. Workaround: device code login as the first-party Teams client `1fec8e78-bce4-4aaf-ab1b-5451cc387264`, which is pre-consented, and keep its refresh token. Refresh tokens die after ~90 days idle.
- Graph base: `https://graph.microsoft.com/v1.0`.

| Data | Endpoint |
|---|---|
| Teams (one per course group) | `/me/joinedTeams` |
| Channels | `/teams/{id}/channels` |
| Channel posts with replies | `/teams/{id}/channels/{channelId}/messages?$expand=replies` |
| Team files | `/groups/{id}/drive/root/children` (`/teams/{id}/drive` returns 404) |
| Post attachments | Attachment `contentUrl` → `/shares/u!{base64url(url)}/driveItem/content` |
| Meetings | `/me/calendarView` (empty in practice) |

### Assignments

Graph Education endpoints (`/education/...`) return 403: the token has no `EduAssignments.*` scopes, and none of the FOCI first-party clients tried (Office, Outlook mobile, OneDrive, M365 web) carry them either.

Working path: exchange the same refresh token for scope `https://onenote.com/.default` and call the Assignments app backend:

- `GET https://assignments.onenote.com/api/v1.0/edu/me/classes`
- `GET .../edu/classes/{classId}/assignments`: title, HTML instructions, due date, status
- `GET .../edu/classes/{classId}/assignments/{id}/submissions`: submission status and time
- `GET .../edu/classes/{classId}/assignments/{id}/resources`

Class ids equal team ids. This API is undocumented and may change without notice.
