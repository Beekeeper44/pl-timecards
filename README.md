# PL Time Cards

Time clock for the Precision Labeling team. Single-file HTML (`public/index.html`) + Vercel functions (`api/`) + Neon Postgres.

## Pages (left panel)
- **Org Chart:** reporting tree. Set “Reports to” for each person in Team settings.
- **Time** (flyout menu):
  - **Time Overview** (admins): Insights (overtime this week, most-used leave type, how long requests take to decide), Today’s snapshot (clocked in / on break / time off), and a day view of the team with Timeline (24-hour bars, breaks in blue, red “now” line) or Time entries (clock in/out, breaks, hours, edit, clock actions). Day / Week / Month ranges (week and month show hours per person per day with totals; click a day to open it), team pills (All teams, Grading, Review, Data…) that filter the insights, snapshot and timeline, date picker, status filter, search, Manila/Pacific time zone. “Schedule time off” adds approved time off for anyone.
  - **My Time** (everyone): “Schedule time off” sends a request. Tabs: **Time clock** (month calendar of your own hours, time off and late days — click a day for its shifts; employee card with department, manager, location and a link to your profile: name, job title, level and tier, live clock, Clock in/out and breaks, elapsed time, a dismissible note when a request is approved or denied, today’s schedule codes 5H/6H/OS/NS with a 5H+6H preset, leave balance, this week by day), **Time Off** (days taken, upcoming and pending this year, by type), **Requests** (sortable table: requested, start, end, leave policy, duration in hours, status, attributes; search, status and leave-type filters; click a row for notes and Cancel), **Settings** (who approves, time zone display, department, link to Account settings). Team members manage time off here; the separate Time Off page is for admins.
  - **Timesheets** (admins: whole team, edit and export) / **My Timesheet** (team members: read-only). Approved time off shows as “Off”.
  - **Time Off:** request Vacation, Sick leave or Bereavement days (only Vacation counts against the yearly leave balance). Team members cancel their own pending requests; admins approve, deny (with a reason) or cancel.
- **Talent:** roster table with Name (✎ Edit), Department, Title, Tier and Reports to (green; click to see that person’s team, double-click for their profile) — sortable, searchable, tier pills with counts (click a department or tier to filter); Edit sets name, department, title, ladder level, tier, start date and leave days. Also: job title (e.g. “Data Associate”) and yearly leave days per person, plus the PL job ladder (L1–L5 in half steps, Prime/Pro/Elite tiers). Admins set title, tier and start date; team members see only their own profile. Reviews follow the Rippling layout: each cycle has a type (**Performance** by default; Probation and Promotion also available) and two parts named from the cycle, e.g. **Year End Review** (written by the manager) and **Year End Self Review** (written by the team member). New cycles default to “Year End Review”, Performance, Jan 1 – Dec 31, self reviews due in 2 weeks and Year End Reviews due Jan 21 of the next year (`review_cycles.review_due`, added automatically; existing cycles get Jan 21). Admins can change both due dates in the cycle header; team members see them in the Due column of My reviews. Team members see both under My reviews as rows with Review, Type, Status and Due. The self review is five questions (the year comes from the cycle’s period, so a Jan 1 – Dec 31, 2026 cycle asks about 2026 and goals for 2027): 1) biggest highlights in the year; 2) lowlights, how you handled them and what you’d do differently; 3) how you’ve grown professionally over the past year; 4) a specific growth goal for next year; 5) a career milestone or personal best for next year. Each one asks for examples, every question must be answered to submit, and the overall self-rating is optional. Answers are saved with their question wording (`reviews.self_answers`, added automatically), so the reviewer sees each question with its answer. **Workflow (4 steps, shown as a bar at the top of the cycle):** 1) **Send the Year End Self Review**, which unlocks it for each person (before that, team members see “Not open yet”); 2) the team writes and submits it, which locks it (their reviewer gets a notification; **Unlock** on the row lets them change it and submit again); Admins and managers read a submitted self review from **Submitted · Read** in the cycle table (or underneath their own form when they click Write). 3) managers **Write** each Year End Review (the review window opens on their form, with the person’s self review underneath to read); 4) **Send** each one (before or after the Year End Review due date, **Jan 21** of the next year by default), or **Send N finished** to send every draft that has all five votes. Submitted dates are saved in `reviews.self_submitted_at` (self reviews written before this update count as submitted and sent). **Sending:** starting a cycle sends nothing. In the cycle, **✉ Send Year End Self Review to N** emails and notifies everyone not sent yet (with the five questions), or use **Send self review** / **Resend self review** on one person; the column shows Not sent → Sent (date) → Submitted. Managers (or admins) click **Write** to do the Year End Review: a **1–5 vote on five statements** (five tick boxes per statement, one choice; the team member sees the same boxes with the vote ticked) (accurate high-quality work; clear, respectful communication; follows through on commitments; ownership and process improvement; collaboration and morale; 1 Needs improvement · 2 Developing · 3 Meets expectations · 4 Exceeds expectations · 5 Exceptional), plus a typed, optional **6. What additional information (if any) do you have for the employee?** box (lines starting with “- ” become bullets, indent two spaces for sub-bullets; saved in `reviews.extra_info`, added automatically) and optional Strengths / Areas to grow / Goals comments. **Save draft**, then **Send review** (in the row or the review window) once every statement has a vote; the team member is notified and sees each statement with its vote. The Rating column shows the average of the five votes (e.g. ★ 4.8 Exceptional). Votes are saved in `reviews.mgr_answers` and the send date in `reviews.self_sent_at` (both added automatically). “What team members and managers answer” in the cycle shows both sets of questions.
- **Profile** (menu under your name → My profile, or click anyone on the Org Chart): name, Active status, job title, and one row of department, work location, work email, phone, start date, manager, level, personal email and role, and direct reports. Team members see their own full profile and a short card for others. Profiles also show a **Time clock** panel (admins on anyone’s profile, team members on their own): status, elapsed time, today and this week, Clock in / Start break / End break / Clock out, and today’s schedule codes — admins can turn on 5H or 6H for someone so they can clock in at that habit time. Admins can Edit any profile, and **View history** lists every change (who, when, old → new).
- **Account settings** (menu under your name, or the left panel): everyone updates their own name, mobile number and personal email, changes their password and appearance. Work email (the sign-in), department and role are view-only for team members; admins can change their own work email here. Every change is logged in the profile’s history.
- **Team settings** (admins: menu under your name › Admin › Team settings, or the left panel): admins also set the **normal shift**: start and end time (enter in Manila or Los Angeles time; it is saved in Manila time), Manila workdays, how early clock-in opens, when someone counts as late, and whether clocking in outside the shift is blocked or just flagged. Shifts can run overnight. **Clock in any time:** teams picked here (CS / Customer Service by default) skip the shift entirely: no window, no Late or Left early. **Habit check-ins:** schedule codes with a time open an extra clock-in window on the day a team member picks them — 5H (5 AM Habit) lets them start at 5:00 AM Manila, 6H (6 PM Habit) at 6:00 PM Manila, from the same “opens early” minutes until the window closes (60 minutes by default). Admins can rename codes, change times (Manila or Los Angeles) and window length; codes without a time are labels only. **CS** (Customer Service · any time) is a pill like 5H: turned on for anyone, they can clock in any time that day with no Late or Left early; it’s always on for the CS team. Team members see the shift on their clock card in both time zones; late clock-ins and early clock-outs are tagged on timesheets. Admins are never blocked. Admins also manage team members here, with an **Admin** switch and an **Active** switch on every row (also on each profile). You can’t remove your own admin access, and at least one active admin is always kept. Admins also manage team members here (email, phone, department, role, reports to, password reset).

## Left panel
Timecards · Time off · Team overview · Schedule overview · Time Clock Setup · Habit Hours · Hours summary · Announcements · Metrics, then a divider with Org chart · Talent, and Team settings (admins) · Account settings at the bottom. Team members see a short panel: Timecards, Org chart, Announcements, My Metrics, and Talent only when a 1:1 or review is set up for them (time off lives under Timecards; settings in the menu under their name). Managers also get Time off, Hours summary, Habit Hours and Schedule overview for their team; Team overview is admin-only; Habit Hours and Schedule overview are for admins and managers (their own team).

**Time Clock Setup** (left panel, admins) — type clock-in and clock-out times like “1:50 PM”, “150pm”, “13:50” or a range “1:50pm-10:10pm”, in Pacific or Manila (the zone you pick stays fixed through daylight saving; the other side’s times are shown next to each row). Defaults: normal shift 1:50 PM – 10:10 PM PT (Mon–Fri PT), 5 AM Habit 12:50 – 1:55 PM PT; 6H and Night Shift are set there. Saved in the database (settings › shift). Previously: the normal shift has a clock-in and clock-out time; **5H**, **6H** and **NS (Night Shift)** each have their own clock-in and clock-out time (defaults 5:00–7:00, 6:00–8:00 PM, 10:00 PM–6:00 AM). Someone with that code can clock in from the “opens early” minutes before its clock-in time until its clock-out time, is marked Late after the grace minutes, and Left early if they clock out before the clock-out time. A clock-out earlier than the clock-in runs past midnight. OS stays a label.

## Timecards and approvals
Every shift starts **Pending**. Admins and the person’s manager can **✓ Approve**, **✗ Not approve** (with a reason the person is notified about), **↺ Undo** (back to pending), **✎ Edit** or **✕ Delete** each entry, or **Approve all** / **Delete pending** at once, and **+ Add entry**. Entries added or edited by an admin/manager are approved. Tiles show total hours, overtime (over 40h per Manila week, 1.5×), approved and pending counts. Filter by status or 5H/6H and by period; export CSV. Not-approved entries don’t count toward hours.
- **Team overview:** “Team breakdown” (admins): tiles (clocked in now, regular hours, overtime, % approved), and everyone grouped by department (collapsible) with department, role, level, rank, today’s schedule codes, status, regular hours, approved/total hours and clocked-in time; range, collapse/expand all, export CSV. “Live day” is the earlier insights + timeline view.
- **Time off calendar** (Time off page, admins): a month calendar showing who is off each day (approved solid, pending dashed), with “N off” counts and busy days tinted (2 off amber, 3+ red); filter by team, hide pending, click a day to see everyone off with their dates and approve/deny pending ones.
- **Live day** shows **On time off today** and **Coming up in the next 7 days** cards.
- **Announcements:** admins post a message (optionally with an image under 1 MB); everyone sees it and gets a notification.
- **Habit Hours:** 5H/6H/NS and hours per person for a week or month.
- **Schedule overview:** a week grid of each person’s codes (5H, 6H, CS, OS, NS) and hours worked; click a day to set codes ahead of time.

## Breaks, lunch and Today
Clocked-in people can **Start break** or **Start lunch** (then End break / End lunch). My Time and profiles show a **Today** panel with one card per shift: shift start, each break start/end, lunch start/end, and shift end, with Late / Left early tags and totals. Shifts started in a habit window are labeled (e.g. 5 AM Habit, 6 PM Habit), and the planned normal shift and picked habit times show at the top. Lunch shows in purple on the timeline.

## 1:1s and reviews (Talent menu)
- **1:1s:** managers (anyone with direct reports) and admins schedule 1:1s with their people: date, time, length, repeat (weekly, every 2 weeks, monthly). Each 1:1 has talking points (both sides add), action items with owners, shared notes and private notes (manager and admins only). “Mark done” on a repeating 1:1 books the next one and carries over open action items. People without a booked 1:1 are listed so nobody is missed.
- **Review cycles:** admins start a cycle (name, period, due date, teams). Everyone included gets a review with their manager as reviewer and is notified. People write a self-review; reviewers rate 1–5 and write strengths, areas to grow and goals, save drafts, then share. The person only sees the manager review once it’s shared.
- **Updates:** managers add praise, feedback or notes for someone; shared ones notify the person, unshared ones stay private.
- Profiles show **Reviews & 1:1s**: next and last 1:1, review status per cycle, and recent updates.

## Adding team members
Admins use **+ Add team member** on Org chart, Talent or Team overview: name, work email, phone, department, job title, reports to (suggested from the team’s lead), level, tier, start date, work location, and an admin switch. The new person signs in with that email (code by email, or text if a phone is set) and creates a password. Team settings still has the quick add form and the roster import.

## Metrics (Metabase)
**Metrics** in the left panel shows Metabase dashboards inside the app.
1. Metabase › Admin › Settings › Embedding › **Static embedding**: turn it on, copy the secret key.
2. Vercel env vars: `METABASE_HOST` (e.g. https://arena-club.metabaseapp.com) and `METABASE_SECRET_KEY`; redeploy. `/api/health` shows `metabaseEmbedding: true`.
3. In each dashboard: Sharing › Embed › Static embedding › **Publish**; note its number from the URL (…/dashboard/42-…).
4. In the app: Metrics › **Manage dashboards** → name, type (Dashboard # / Question # / Public link), number or link, and who can see it (Admins / Admins + managers / Everyone).
**Cards today (built in):** add `METABASE_API_KEY` (Metabase › Admin › Settings › Authentication › API keys, in a group that can view the question) and the app uses question **46531** (arena-club.metabaseapp.com/question/46531, the PL daily cards) by default; change it in Manage dashboards if needed. The question needs `WORK_DATE`, `FULL_NAME`, one column per task (CROP_CARDS, CARD_TYPE_CARDS, …) and `TOTAL_CARDS`. Metrics then opens on a **Cards today** tab: totals, cards per task per person, column totals, **Day / Week / Month** pills (Day opens on today’s date, Week is Monday–Sunday, Month is the calendar month; counts are added up per person), a picker for earlier days, weeks or months (whatever the question returns, up to 120 days), **team pills** with counts, sorting and CSV (for the period and team shown). Until `METABASE_API_KEY` is set (and in the demo), the page shows **demo data**: made-up daily numbers for every team except CS, built around 25 people’s real Fri, Oct 30 counts, so the team pills, Week and Month all have something to show; a “Demo data” banner marks it. In Week and Month there’s an **Avg / day** column (cards ÷ days that person had cards) and the last summary card shows the average per person per day. Click any person’s row to put their own numbers in the summary cards (cards, days with cards or rank, biggest task, average per day); click the row again or **× Whole team** to go back. Names are matched to the roster automatically (e.g. “Benedict Bueno” → Ben Bueno). Admins get **Team** and **Personal** pills on Metrics; everyone else (managers included) sees only their own numbers under **My Metrics**. Results are cached in the database (`mb_cache`) and refreshed from Metabase every hour; admins can pull the latest right away with **↻ Refresh metrics** (under Manage dashboards).

**My Metrics** (team members’ left panel): just their own numbers from the same question: cards today, this week, daily average, best day, today by task, a 14-day bar chart (today in green) and a by-day table. The server only ever returns their own rows.

The server signs a fresh embed link (valid 1 hour) each time Metrics opens; the secret key never reaches the browser. Team members only see the Metrics item when at least one dashboard is shared with them. Dashboards follow light/dark mode.

## Speed and live updates
- Database setup runs once per schema version (a hash of the migration code saved in `settings.schema_version`) instead of on every cold start.
- The main data request runs its ~15 queries in parallel.
- A reload paints instantly from this tab’s last copy (sessionStorage, cleared on sign-out) while fresh data loads; a thin bar at the top shows when it’s refreshing.
- **Live updates:** every write bumps a counter (`app_rev` sequence). Each open browser checks `/api/data?ping=1` every 2 seconds (and right away when the window comes back into focus) (one tiny query) and refreshes when it changes, so changes show for everyone within about 4 seconds. A full refresh also runs every 60 seconds as a backstop.

## Search
The top bar has **Search people and pages** on every page (shortcut **/** or **Ctrl/⌘+K**): people by name, title, team or location (admins also by email) with a green “in” tag if they’re clocked in, team shortcuts (opens Team overview filtered to that team), and pages. Arrow keys + Enter, Esc to close; on phones it’s the magnifier icon.

## Org chart
Interactive, fits the screen: cards show photo, name, title, time at the company, location + flag, team tag and direct|total report counts. **+ / ×** under a card shows or hides that person’s reports (two columns off a centre line, or a compact block for big teams). Drag to move, scroll to pan, pinch or Ctrl+scroll to zoom, **− Fit +** buttons, **Expand all / Collapse all**, and **Find someone** (opens the path and highlights the card). Click a card to open the profile; ← Back returns to the chart. **Edit chart** (admins): drag a card onto someone to change who they report to (drop on Precision Labeling for no manager), with a confirm and **↺ Undo last move**; team cards without a lead (e.g. Analysts) have **Pick a lead**: the lead takes the top spot and the others report to them; tap a card to pick a manager from a list, tick **Show on their own under their manager** (places them outside the team group, like Abe under Ehm; juniors at L1 always show that way), add a report under them, or open the profile. Moves that would create a loop are blocked (red) in the app and on the server.

## Inviting the team
Team settings › **Invite your team to sign up**: first **Sync emails from the PL list** (runs the roster import if anyone from the list is missing), then pick a team pill (it shows everyone in that team; the pill numbers are team sizes and the status tabs count within the team), filter Not invited / Invited / Signed up, and by team, tick people (or **Select all**) and **✉ Send invites**. Each person gets an email (via Resend) with a **Sign up** button that opens the app with their work email filled in; they enter the code and create a password. **Resend** per person, or **🔗 Link** to copy their sign-up link for text/chat. Set `APP_URL` to your Vercel URL for the links (otherwise the current site is used).

## Break and lunch reminders
An orange band pops up across the middle of the screen, with a short chime, 5 minutes before each break or lunch (Manila time): **7:55** for the 8:00 AM break, **9:55** for 10:00 AM lunch, **10:55** to clock back in at 11:00 AM, and **12:25** for the 12:30 PM break. It only shows to people who are clocked in (the 11:00 one only while they’re on lunch), and never to the Customer Service (CS) team (CS members don’t see the reminder settings either). It counts down to the time, and has a button that does the clock action (Start break / Start lunch / End lunch) plus **Dismiss** (Esc). A dismissed reminder doesn’t come back that day, and one that no longer applies (break already started, clocked out) closes on its own. It needs the app open in a browser tab; browsers only play the chime after the person has clicked or typed on the page. Everyone can turn the sound off or play it in **Account settings › Break and lunch reminders** (saved per browser). The times are in `REMINDERS` in `public/index.html`. In the demo, the **Test reminders** buttons in the top bar show each one right away.


## Editing a shift
Add shift / Edit shift use a date box plus **hour** (1–12), **minute** and **AM/PM**. Type the numbers, pick from the list (hours 1–12, minutes 00 / 15 / 30 / 45), or scroll the mouse wheel over the hour or minute (minutes jump by 15; arrow keys step by 1, Shift+arrow by 15). Scrolling the hour past 11→12 flips AM/PM. Clock out has **Clear** to leave the shift open. Times are in the zone shown under the form.


## Team overview time range
Team overview opens on **Live day**; the toggle reads **Live day | Team breakdown**. Live day opens on **Time entries** (each person’s day in order), with **Timeline** one click away. Team breakdown opens on **This week** (Monday–Sunday); pills switch to **Today**, **This month**, or **Range** (pick any from/to dates). Every range is cached in the browser, so switching shows numbers right away; after any change (yours or someone else’s, picked up by the 2-second live check) the cache refreshes in the background, and Today / This week / This month are pre-loaded after each refresh. A change you make while a background refresh is running is queued and shown as soon as that refresh ends, instead of waiting for the next live check.


## Profile time views
On a profile, the day card has pills: **Today** (the live day: start, breaks, lunch, end), **This week**, **This month** and **Range** (pick from/to dates on a calendar). Week, month and range show totals (Regular, Overtime, Worked, Approved, Time off, Days worked) and one row per day like Rippling: Day, Start, End, Duration, Details (habit, break ☕ and lunch 🍴 chips, notes, Late/Edited), Hours worked and Status. Days without a shift are shaded, approved time off shows as a chip, and admins/managers click a shift to edit it. Ranges are cached per person (week and month are pre-loaded), so switching is immediate.


## Timecards panel
On a profile and in My Time, the Timecards panel uses pills instead of dropdowns: **Today, This week, This month, Last month, Range** (from/to calendar), with the dates shown next to them, and status pills with counts (**All, Pending, Approved, Not approved**, plus 5 AM / 6 PM Habit when there are any). Approve all, Delete pending, Add entry and Export CSV work on what’s shown. (A CSS name clash with Time Clock Setup that squeezed this table to half width is fixed.)


## Attendance: early, late and left early
Normal shift and 5 AM / 6 PM Habit (CS and the teams under “Clock in any time” are exempt; that list also has **Admins**, which covers everyone with the admin role):
- **Clocking in early** is allowed (the window opens 15 min before) but **doesn’t count**: hours start at the scheduled clock-in time (e.g. 6 PM Habit 5:50–7:10 PM: in at 5:40 → counted from 5:50). Saved in `shifts.count_from`; the row shows “From 5:50 PM”.
- **Late:** more than **2 minutes** after the start (grace) → marked Late with the minutes (`late_by`).
- **Left early:** clocking out more than **5 minutes** before the end → marked Left early with the minutes (`early_by`). Up to 5 minutes early is fine.
- The person’s **manager is notified** (in the app and by email) when they clock in late or out early; people with no manager notify the admins.
- **Colors:** early clock-ins are **green** (good); late clock-ins and leaving early are **red** (bad).
- **Per person:** the profile shows a **Last 30 days** line on Today (early clock-ins · late clock-ins with minutes · left early with minutes), and This week / Month / Range show **Early clock-ins**, **Late clock-ins** and **Left early** totals with a tag on each day (“Early in 9m”, “Late 7m”, “Left early 18m”). Team overview has an **Attendance** column per person and per team for the chosen range.
- Grace (2) and allowed-early (5) minutes are in **Time Clock Setup** (an already-saved time clock is switched to 2 / 5 once on deploy). Shifts an admin edits by hand count exactly as entered.

## Profile photos
Anyone can add or change their own photo by clicking their avatar on their profile or Timecards card (admins can do it for anyone, and remove photos). After picking a file, a **Position your photo** window opens: drag to move, use the slider (or scroll / pinch) to size it, and the circle shows exactly what will appear; **Save photo** uploads it, **Choose another** swaps the file. The browser crops it to a 400px square JPEG before upload; it’s stored in the database and served from `/api/data?photo=<id>` with long-lived caching, so the regular data refresh stays small. Photos show everywhere avatars appear (top bar, profiles, Timecards, Team overview, org chart, time off, 1:1s).

## Notifications
When an admin approves, denies, cancels or schedules time off, the team member gets a notification: a bell in the top bar with an unread count, a banner on My Time (Time clock and Requests) with the admin’s message and a “Got it” button, a “New” marker on the request row, and an email too when Resend is set up. Admins approve or deny from Time Off → “Waiting for your decision”, with an optional message.

## Appearance
Light and dark themes. Defaults to the device setting; anyone can switch System / Light / Dark from the menu under their name or in Account settings.

## Sign-in flow (email + password)
- **First time (sign up):** enter your work email → we email a 6-digit code (or text it, if a phone is on file) → enter the code → **create a password** and enter a mobile number (required; Philippine numbers like 0917… are saved as +63…; skipped if an admin already put a number on file). The code step proves the email is yours, so nobody can claim a coworker’s account.
- **Every time after:** email → password. That’s it, on any device.
- **Passwords:** at least 8 characters with at least one letter and one number; very common ones (password1, 12345678…) and ones containing your email name are refused. Stored only as a salted scrypt hash; nobody, including admins, can see them.
- **Forgot password:** email → **Forgot password?** → get a code → enter it → create a new password (signs you in). The old one stops working.
- **Change password:** Account settings › Change password (needs the current one).
- **Admins:** Team settings › Team members › **Reset password** clears someone’s password; next time they sign in they verify with a code and create a new one.
- 5 wrong passwords locks the account for 5 minutes. Codes expire after 10 minutes, 5 wrong tries per code, 5 codes per hour per person.
- Sign-ins last 14 days and renew themselves while the app is used. Idle sign-out is **off** by default; admins can turn it on for shared computers in **Team settings › Sign out when idle** (15 min – 4 hours, team members only).
- Phone numbers on file were cleared once in Oct 2026 (a one-time migration on the first deploy after the change); people add their own at sign-up, and admins can still edit them in Team settings.
- Anyone who set a 4–6 digit PIN under the older version can still sign in with it as their password, and should change it in Account settings.

## Demo
“Explore the demo” on the sign-in screen (or add `?demo` to the URL) loads sample PL data in the browser: no server, nothing saved. A bar at the top switches between the admin view and a team member’s view. It also works when `index.html` is opened on its own.

## Troubleshooting
Open `/api/health` on the deployment. It reports whether the database connects and which settings are missing (no secrets shown). If sign-in says “Server setup: …”, fix that variable in Vercel and redeploy.

## Setup (Vercel + Neon)
1. **Neon:** create a database (or add the Neon integration in Vercel → Storage, which sets `DATABASE_URL` for you; `POSTGRES_URL` also works). Tables are created automatically on the first request.
2. **Resend:** verify a sending domain for email codes and invites.
3. **Twilio (optional):** a **Verify** service (SMS + Voice, Geo Permissions for the Philippines) lets people get codes by text or call once their mobile number is on file. Without it, codes go by email.
4. **Vercel → Settings → Environment Variables:** add everything in `.env.example` (except `DEV_SHOW_CODES`): `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAILS`, `RESEND_API_KEY`, `RESEND_FROM`, `APP_URL`, and the Metabase pair used by the other Arena tools, **`METABASE_HOST`** + **`METABASE_API_KEY`** (plus `METABASE_SECRET_KEY` only if you embed dashboards on Metrics). `METABASE_SITE_URL` from older setups still works.
5. Deploy, then open `/api/health` to check everything is green.
6. Sign up with an email listed in `ADMIN_EMAILS`: you get an email code, create your password, and become an admin.
7. Team settings → **Import the PL team**, then **Invite your team to sign up**.

## Importing the team
Team settings → **Import the PL team** loads the roster built from the team screenshots and email list (Managers, Review, Data, Items, Recomp, Community, CS, Grading: 125 people, all with emails) with titles, tiers and reporting lines. Matching is by email, so it can be re-run to update. People on the email list without a team can be given a department there and included. Anyone added to the roster without an email is skipped until one is added.

## Local testing
`DEV_SHOW_CODES=1` (ignored on Vercel production) skips sending and shows the code on screen.


## Appearance and color
Menu under your name (and Account settings) › **Appearance**: **Light** · **Dark** (no System option; until someone picks, the app starts in whichever mode their computer uses). **Color** has an **On/Off** toggle and swatches (Blue, Pink, Purple, Green, Turquoise, Graphite).
- **Color off:** the original Light and Dark looks.
- **Color on:** **Light** = e.g. light pink (pale pink top bar and panel, deep pink page, light pink boxes and pills); **Dark** = dark pink (pink-tinted bar, panel and page, dark boxes). Picking a swatch turns Color on.
- Status and team colors (clocked in, late, team dots) never change. Saved per browser.


## Clock in from a computer only
Time Clock Setup › **Clock in from**: **💻 Computers only** (default) or **Any device**. With Computers only, phones and tablets can’t clock in, out, or start/end breaks or lunch: the server refuses it (browser hints + user agent, plus a touchscreen check that catches iPads posing as Macs), and on a phone the clock buttons are replaced by a note. **Phones allowed for** lets chosen teams (and Admins, on by default) still use phones. Admins can always fix someone else’s punch from any device. Every shift records the device used to clock in and out (`shifts.device_in` / `device_out`: Computer, iPhone, iPad, Android phone, Android tablet, Phone or Tablet). Anything not from a computer is flagged in purple wherever shifts show (“📱 iPhone in & out”, “📱 In: iPad”), the profile totals show **Phone / tablet N×** with the devices used, and Team overview’s Attendance column shows “📱 N mobile” per person and team. On **Live day**, phone/tablet clock-ins get a purple badge next to the status (timeline), **Time entries** shows the whole day in order: **Clock in** (time + device), each **Break start → Break end** and **Lunch start → Lunch end** with times, length and any phone/tablet used, then **Clock out** (time + device); the device for each break/lunch start and end is saved in the shift’s `breaks` (`ds` / `de`), and hovering a timeline bar lists both devices. Under each **In since** time Team breakdown shows the device used to clock in (💻 Computer, or 📱 iPhone / 📲 iPad / 📱 Android phone in purple). It isn’t airtight against someone deliberately faking a desktop browser; limiting clock-ins to the office internet connection would be the stronger option.

## Save test
`tests/run-e2e.sh` runs the whole app against a real Postgres and checks that every save sticks (sign-up, roster import, invites, self edits, photo and image uploads, clocking, shift edits and approvals, time off, schedules, settings, announcements, the full review flow, password resets, computers-only). See `tests/README.md`.


## Normal shift vs habit shifts
Every shift is labelled **Normal shift**, **5 AM Habit**, **6 PM Habit** or **Night shift** (from the habit code it was clocked in under). Live day › Time entries shows the label above each clock-in time. On a profile, This week / Month / Range has pills (**All shifts · Normal shift · 5 AM Habit · 6 PM Habit · Night shift**, with counts; habit pills appear when there are any) that filter the day table and the totals, and the Details column shows the label on every shift. The Timecards panel’s status pills add **Normal shift** and the habit types as filters too. The **Today** card has pills **All · Normal shift · 5H · 6H · NS · OS** (plus **CS** for the CS team or on a CS day): pills for what’s on today’s schedule or was worked are lit, others are faded, and clicking one shows just that session (the card title now says “Normal shift” instead of “Shift”).


## 1:1s
**Schedule 1:1s** books one person or many at once: tick people (search, **team pills** to show one team with “ticked/total” counts, **Select all N in Team**, or **My team** for all your reports), pick the date, start time, length, gap between (back to back by default) and how often it repeats, and they’re booked one after another (e.g. 10:00, 10:30, 11:00). Each person is notified. Add a **Google Meet link** (or Zoom/Teams; **New Meet ↗** opens Google Meet to create one, then paste it): it’s saved on the 1:1 (`meetings.link`), sent in the invite, shown as a **🎥 Join Meet** button on the 1:1 list and in the 1:1 window (the manager can change it there), and carried to the next repeat. A 1:1 is **deleted**, not cancelled: **Delete 1:1** in the 1:1 window removes it (and its repeats) for both people; only the manager or an admin can delete, and the other person is notified if it was still upcoming. Its talking points, action items and notes are deleted with it. The **Book a 1:1** box at the top is only a reminder of people with no upcoming 1:1 (click a name to book); **✕ Hide** hides it for 30 days.


## Deleting a team member
Admins can **Delete** someone from Team settings › Team members, the invite list (🗑), or their profile. A confirmation asks you to type their full name; it permanently removes the person and their own timecards, time off, schedules, reviews, 1:1s and notifications (people who reported to them stay, with “reports to” cleared). You can’t delete yourself or the last admin. To keep someone’s history, turn off **Active** instead. Deleted people are remembered (`settings.deleted_people`), so **Import the PL team** skips them (the import panel lists who’s left out) and Metrics hides their rows; adding them again with **Add a team member** brings them back.


Admins are marked with a blue **Admin** badge (shield icon + word) in the top bar, on their profile and My Time card, and a small “admin” chip with the same icon next to their name in team lists. Everywhere else an admin’s name appears (Live day, Schedule overview, Hours summary, Announcements, Metrics, Org chart, 1:1s, Team settings…) a small blue shield follows the name (hover: “Admin”), including names inside sentences such as “approved by Alan Bailey” or “· Karl Calma · 5d ago”; it updates when someone’s admin switch changes.


Talent’s people table is grouped by team, all collapsed to start (team name, headcount and Prime / Pro / Elite counts). Click a team to open it, or use **Expand all / Collapse all**. Searching, picking a team pill or a “Reports to” filter opens the matching teams automatically.


The time off **Approve / Deny** window is wide (900 px) and shows the team, approved days off this year (of their allowance) and who else is off at the same time. Time Clock Setup has **✕ Clear times** on each habit row.


Time Clock Setup: the CS code is named **Customer Service** (any time that day, no Late / Left early). **Customer Service, OS and NS each have an On/Off switch**; a switched-off code is hidden from every Schedule row and Today pills and can’t be set.


**Edit shift** lets you change clock in, clock out and each **Break / Lunch** start and end (Break 1, Lunch, Break 2…; add or remove rows, switch a row between Break and Lunch). Times are typed like 3:50 PM on the shift’s day (past midnight rolls over). The server checks they fall inside the shift and don’t overlap. If the times aren’t known you can still enter total break minutes.


## Team timecards (admins and leads)
My Time › Timecards has a **My timecard | Team timecards** switch. Team timecards lists everyone who worked in the period (Today, This week, Last week, This month, Last month or a Range up to 62 days) with entries, hours, pending, approved and not approved, and what they worked (**5H, 6H, NS, OS, CS**). Filter by **Needs approval / All approved / Has not approved / Everyone** (Everyone lists the whole team, including people who haven’t signed up or clocked in yet), by shift (**5H · 6H · NS · OS · CS**, from the shift itself or that day’s schedule codes; CS also covers the CS team), by team, or by name. Tick people (or the header box for everyone shown) and use **✓ Approve selected** or **✕ Don’t approve selected** (with an optional reason each person sees) to act on all their pending entries at once; **✓ Approve N** does one person. Click a name to see their entries with Approve / Not approve / Edit for each.


**Usual Google Meet link:** Account settings › **My Google Meet link** (Alan’s is preset to `https://meet.google.com/ara-qmvp-frj`). Schedule 1:1s fills it in, and any 1:1 booked without a link uses the manager’s usual link. Upcoming 1:1s of Alan’s that had no link get it on the next deploy.


## First sign-in and demo mode
- **First admin:** emails in `ADMIN_EMAILS` become admins the first time they sign in. If `ADMIN_EMAILS` isn’t set, `alan@arenaclub.com` can still set the app up. Before any admin exists, the sign-in page explains this instead of “we don’t recognize that email”.
- **Demo mode is off by default.** The sign-in page has no “Explore the demo” button and `?demo` links show “The demo is turned off”. Admins can switch it on in **Team settings › Demo mode**. (The published preview link is always the demo.)


## Personal sign-up links
Team settings › Invite your team: **✉ Send invites** emails each person a **personal link**, **🔗 Link** copies one person’s link, and **🔗 Copy links (N)** copies “Name — link” for everyone ticked (to paste in a chat). Opening the link goes straight to **Create your password** (+ mobile number) with no code needed; the link is signed with `SESSION_SECRET`, works for 14 days, and once they’ve signed up it only offers normal sign in. Treat links like keys: send each one only to that person.

The first time an admin signs in to an empty app, the whole PL list (125 people, minus anyone deleted) is added automatically.


## First-time setup without email
If email codes can’t be sent yet (Resend not set up), the first admin can still get in: enter your admin email, then **First-time setup: create my password without a code**, type the **setup key** (the first 8 characters of `SESSION_SECRET` in Vercel), and create your password + mobile number. It works only for an admin email and only until the first admin has a password; after that it’s closed and everyone uses the normal sign-in. When sending a code fails, the message now says why (e.g. the RESEND_FROM domain isn’t verified in Resend).


Work location: everyone on the PL team is set to **Philippines** (on import, and once for existing people whose location was empty or “Manila”). Alan Bailey is left as is. Admins can still change anyone’s location on their profile.


Metrics: a Metabase name that isn’t on the team list shows **not on the team list · ＋ Add to team** (admins). It opens Add team member with the name filled in (Patrick Emerson defaults to **Review**); once added, his numbers count for him.


Metrics also covers people Metabase has who aren’t app users (the Oregon reviewers **Lea, Dustin, Mikayla, Kaity, Jordan Hunt, Lulu, Austin and Arman**, are **Team Oregon**, their own pill in Metrics; first names match whatever last name Metabase shows; **Princess Cordova** counts under **Grading**). Their rows show “Oregon · from Metabase”, count in the Oregon pill and averages, and admins can change the team with the small **Set team** menu on the row (saved in `settings.metrics_teams`), or add them as app users.


**Same person, different name:** Metabase’s “Patrick Emerson” is **Pat Castillo** (Review), so those numbers are combined under Pat; likewise “Princess Cordova” / “Cess Cordova” is **Princess Cabalar**, now in **Grading** (Grading Annotator 1, reports to Ehm Crucillo) (`NAME_ALIASES` in `api/_lib.js`; add more there if needed).


Metrics tables keep their header (Crop · Data · … · Total, with the team colors) pinned at the top while you scroll through people; the table scrolls inside its card.


**Review questions:** Reviews › **📝 Questions** (also in New review cycle) shows the self review questions (with hints; {Y} = year reviewed, {N} = next year), the manager statements (1–5 votes) and the open question. Admins can edit, add or remove them and Save, or **Reset to the original questions**. New self reviews and manager reviews use the saved questions; reviews already sent keep theirs.


## Metrics days: Pacific vs Manila
Metabase’s `WORK_DATE` is a Pacific date. With the top bar on **🇺🇸 Pacific**, a day shows that WORK_DATE (Oregon 8:45 AM–5:15 PM; the PL shift crosses the same afternoon, 1:50–10:10 PM). On **🇵🇭 Manila**, a day D shows WORK_DATE D−1 (PL 5:50 AM–2:10 PM Manila; Oregon falls 12:45–9:15 AM Manila the same day). Each Metabase day lands on exactly one day in each view, so the two never mix; week and month ranges follow the same rule, and switching Manila/Pacific reloads Metrics. The card’s **TEAM** column decides teams (`Review` → the Oregon pill, never matched to a PL person by a similar name; `PL` → matched to the PL list), and the **TEAM TOTAL** row is left out.


**Side by side:** in Metrics › Cards by task (Day), **⇆ Side by side** shows a 🇺🇸 Pacific day next to a 🇵🇭 Manila day, each grouped Oregon (Review) and PL · Manila team with their shift times and totals. **Same work** lines up the same shifts (Pacific D ↔ Manila D+1, e.g. Mon Nov 2 PT ↔ Tue Nov 3 Manila); **Same date** shows the same calendar date in both zones. The regular table stays below.


Schedule row: an admin who can clock in any time (Time Clock Setup › Clock in any time › **Admins**) sees a **🛡 Admin** chip instead of **CS** that switches their own “clock in any time” on (blue, ✓) or off (normal shift times, Late / Left early apply; saved per admin in `members.anytime_off`) on their My Time card and profile (both the badge under their name and the Schedule row), and Schedule overview / Live day don’t show CS for them either. Others still see CS.


Metrics: when a single team pill is picked, the table also lists that team’s people with no cards in the period (faded, “no cards this day”), so nobody looks missing. The pill counts still count people with cards.


**Habit sessions for any-time people:** admins and the CS team can clock in any time, but a session that starts in a habit window (5 AM Habit, 6 PM Habit, Night shift) is still recorded as that habit instead of a Normal shift (no Late / Left early). **Edit shift › Shift type** fixes any session (Normal shift, 5 AM Habit, 6 PM Habit, Night shift).


**Who fills in what:** the person a review is about always gets the **self review** questions (admins too), and their reviewer (manager) gets the 1–5 manager review. Nobody can write their own manager review; the server refuses it.


## Overtime board (admins only)
Metrics › **Team · Overtime · Personal** pills (admins): **Overtime** opens the overtime board. Overtime reads Metabase question **46762** (same columns as Cards by task plus `SHIFT_HOUR`, e.g. “10 PM – 11 PM”) and shows the same table, with hour pills: **All hours · 1 hr · 2 hr · 3 hr · 4 hr**, counted from the end of the normal shift (1 hr = 10–11 PM PT, 2 hr = 11 PM–12 AM…). Metabase hours are Pacific; on 🇵🇭 Manila the pills show Manila hours (1 hr = 2–3 PM) and the days follow the same Pacific/Manila rule as Cards by task, so toggling keeps the numbers the same. “All hours” uses Metabase’s All hours rows when present, otherwise it adds up the hour rows. Summary rows like **HOUR TOTAL** / TEAM TOTAL are left out. SHIFT_HOUR can come as “10 PM – 11 PM”, an hour number (22), “22:00” or a timestamp; column names are found automatically if they differ slightly (…NAME, …DATE, TOTAL…, …HOUR). Team members can’t open it (the server refuses).


**Name matching (Metabase → team):** exact names, then aliases, then the email name (“Ian f” = ianf@…), then partial names; a single letter must be an initial of one of their names (“Ian B” → Ian Benedict Banua); if two people match equally well the row isn’t guessed (it shows as not on the team list).


**Unsend:** in a review cycle, a sent self review has **Unsend** under “Sent …” (closes it for them until you send it again; anything they typed is kept; once they’ve submitted, use **Unlock** instead), and a sent manager review has **Unsend** under “Sent” (back to a draft they can’t see). Reviewer or admin only.


Metrics day menus (Team and Overtime) list every day back about two months (weeks: 10, months: 3) plus any older day Metabase has, with **‹ ›** buttons to step to the previous / next day, week or month.


Overtime pills show both clocks (e.g. **1 hr · 2–3 PM Manila · 10–11 PM PT**, the chosen time zone first). When Overtime opens and today has no overtime yet, it shows the latest day that has numbers (in the chosen time zone).


Metrics shows **Recomp** before **EV**. Metabase has those two columns the wrong way round, so the app swaps them (Manage dashboards › **Swap EV and Recomp numbers**, on by default; untick once Metabase is fixed). Applies to Cards by task, Overtime and Personal.


**Running cycle:** admins can **＋ Add teams** (or Everyone) to an open cycle; people already in it are skipped and their manager becomes the reviewer. Step 1 has **Send to everyone · N** (all who haven’t got their self review) and, when it’s a subset, **My team · N** (people you review).


**Habits that stick:** on the Schedule row (My Time, profiles) **🔁 Every day** keeps today’s 5H / 6H / NS (etc.) on every workday until it’s switched off; changing the chips while it’s on updates the coming days. Schedule overview’s day window has **🔁 Repeat every workday from this day on**. Repeating days are filled two weeks ahead (`members.default_codes`, `schedules.auto`); a day changed by hand is never overwritten.


**My reviews:** each self review row has a green **Start self review** button (then **Continue self review**, then **View**). The manager’s review only appears in My reviews once it’s been sent (**View review**). Everyone’s self review uses the current questions from Reviews › Questions until they start answering.


**Review cycle table:** admins get **My reviews to do · N** (only people who report to them; the default when they have any) and **Everyone · N**. The steps, counts and send buttons follow the pill you pick. Leads who aren’t admins always see just their own reports.


Review cycles skip anyone who would review themselves (no manager above them, like Alan): they get no self review. Existing ones with nothing written are removed once on deploy.
