import { fillRepeatingSchedules, DEFAULT_OVERTIME_QUESTION, renewSession, earlyOutBy, isPhoneReq, deviceOf, inviteToken, sendInvite, DEFAULT_CARDS_QUESTION, metabaseCardRows, matchMember, metabaseReady, metabaseEmbedUrl, bumpRev, getRev, unsign, cookies, sql, ensureSchema, body, send, fail, currentUser, PAY_TZ, normEmail, emailOk, phoneOk, normPhone, DEPTS, setupMessage, getShift, clockInCheck, leftEarly, DEFAULT_SHIFT, notify, rangeText, MB_HOST } from "./_lib.js";

const dayOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
// Meeting link: an https web address (Google Meet, Zoom, Teams…); "meet.google.com/abc-defg-hij" gets https:// added.
const cleanLink = v => { let x = String(v || "").trim().slice(0, 300); if (!x) return null; if (!/^https?:\/\//i.test(x)) x = "https://" + x;
  try { const u = new URL(x); return u.protocol === "https:" ? u.toString() : null; } catch { return null; } };
// "Year End Review" → "Year End Self Review" (same rule as the app).
const selfReviewName = n => /review/i.test(n) ? n.replace(/\b(review)\b/i, "Self $1") : `${n} Self Review`;
// ponytail: column list repeated in the two shift queries (neon 0.10 tagged templates can’t nest fragments)

async function openShift(memberId) {
  const [s] = await sql`select id, breaks from shifts where member_id = ${memberId} and clock_out is null`;
  return s;
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    // Cheap "has anything changed?" check that browsers poll every few seconds (no member lookup).
    if (req.method === "GET" && req.query.ping) {
      if (!unsign(cookies(req).pltc_s)) return fail(res, 401, "Signed out");
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, { rev: await getRev() });
    }
    const me = await currentUser(req);
    if (!me) return fail(res, 401, "Signed out");
    if (req.method === "GET") await fillRepeatingSchedules().catch(() => {});
    renewSession(req, res, me);   // keep active people signed in
    const admin = me.role === "admin";
    // Late / left early: tell the person's manager (or the admins if they have none), in the app and by email.
    const tellManager = async (mid, what, shiftName, startMs) => {
      const [p] = await sql`select name, manager_id from members where id = ${mid}`; if (!p) return;
      const to = p.manager_id ? [p.manager_id] : (await sql`select id from members where role = 'admin' and active`).map(x => x.id);
      const at = startMs ? ` (starts ${new Date(startMs).toLocaleTimeString("en-US", { timeZone: PAY_TZ, hour: "numeric", minute: "2-digit" })} Manila)` : "";
      for (const id of to) if (id !== mid) await notify(id, { kind: "attendance", title: `${p.name} ${what} · ${shiftName}${at}`, link: `#profile-${mid}`, footer: "Open PL Time Cards to see their timecard." });
    };

    // Profile photo bytes (?photo=<id>&v=<version>), cached by the browser.
    if (req.method === "GET" && req.query.photo) {
      const [p] = await sql`select photo from members where id = ${String(req.query.photo)}`;
      const m = p?.photo && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(p.photo);
      if (!m) return fail(res, 404, "No photo.");
      const buf = Buffer.from(m[2], "base64");
      res.setHeader("Content-Type", m[1]); res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.status(200); return res.end ? res.end(buf) : res.send(buf);
    }
    // Cards today: per-person card counts by task from a saved Metabase question (?production=1&date=YYYY-MM-DD).
    if (req.method === "GET" && req.query.production) {
      // ?card=overtime: the Overtime board (admins only), same layout, filtered by overtime hour (?slot=1..4)
      const ot = req.query.card === "overtime";
      if (ot && !admin) return fail(res, 403, "Only admins can see overtime.");
      const [cfg] = await sql`select value from settings where key = ${ot ? "overtime" : "production"}`;
      const c = cfg ? (cfg.value || {}) : { cardId: ot ? DEFAULT_OVERTIME_QUESTION : DEFAULT_CARDS_QUESTION };   // no setting saved yet → the built-in question
      if (!c.cardId) return send(res, 200, { configured: false });
      // Metabase's WORK_DATE is a Pacific date. ?tz=manila shows Manila days: a Manila day D holds WORK_DATE D−1
      // (the PL shift 1:50–10:10 PM PT = 5:50 AM–2:10 PM Manila next day; Oregon's 8:45–5:15 PT = 12:45–9:15 AM Manila next day).
      const manila = req.query.tz !== "pacific";
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: manila ? PAY_TZ : "America/Los_Angeles" }).format(new Date());
      const day = dayOk(req.query.date) ? req.query.date : today;
      let data;
      const force = admin && req.query.refresh === "1";
      try { data = await metabaseCardRows(c.cardId, force); if (force) await bumpRev(); } catch (e) { return send(res, 200, { configured: true, cardId: admin ? c.cardId : undefined, error: e.message }); }
      // Column names: the saved ones, else the usual ones, else the first column whose name says what it is (…NAME, …DATE, …TOTAL…)
      const pickCol = (want, re) => data.cols.includes(want) ? want : (data.cols.find(k => re.test(k)) || want);
      const nameCol = c.nameCol || pickCol("FULL_NAME", /NAME/i), dateCol = c.dateCol || pickCol("WORK_DATE", /DATE|DAY/i), totalCol = c.totalCol || pickCol("TOTAL_CARDS", /^TOTAL/i);
      const rawDay = v => { if (!v) return ""; const s = String(v); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const t = Date.parse(s); return Number.isFinite(t) ? new Date(t + 12 * 3600e3).toISOString().slice(0, 10) : ""; };
      const plus1 = k => { const [y, mo, d] = k.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10); };
      const toDay = v => { const k = rawDay(v); return k && manila ? plus1(k) : k; };   // the day this row belongs to in the chosen view
      const teamCol = c.teamCol || "TEAM";
      // Skip summary rows like "TEAM TOTAL"; Metabase's TEAM column says which team (Review = the Oregon team, PL = Manila)
      const isTotalRow = r => /^\s*([a-z]+\s+)?totals?\s*$/i.test(String(r[nameCol] || "")) || /^\s*(grand\s+)?total\b/i.test(String(r[nameCol] || ""));   // TEAM TOTAL, HOUR TOTAL, Total…
      const mbTeam = r => String(r[teamCol] ?? "").trim();
      const oregonRow = r => /^review$/i.test(mbTeam(r));
      const days = [...new Set(data.rows.map(r => toDay(r[dateCol])).filter(Boolean))].sort();
      const roster = await sql`select id, name, email, manager_id from members where active`;
      const team = admin ? null : new Set([me.id]);   // only admins see the team; everyone else sees just their own numbers
      const num = v => typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
      data = { ...data, rows: data.rows.filter(r => !isTotalRow(r)) };
      // Manage dashboards › "Swap EV and Recomp": Metabase has the two columns the wrong way round, so flip them here (on by default)
      const [sw] = await sql`select value from settings where key = 'swap_ev_recomp'`;
      const swapEv = sw ? sw.value === true : true;
      if (swapEv) data = { ...data, rows: data.rows.map(r => ({ ...r, EV_CARDS: r.RECOMP_CARDS, RECOMP_CARDS: r.EV_CARDS })) };
      // Overtime: SHIFT_HOUR is a Pacific clock hour ("10 PM – 11 PM"). Slots go in order from the end of the shift (1 hr, 2 hr…).
      let slots = [];
      if (ot) {
        const hourCol = c.hourCol || pickCol("SHIFT_HOUR", /HOUR/i), isAll = v => /^\s*all/i.test(String(v || ""));
        // SHIFT_HOUR can come as "10 PM – 11 PM", a number (22), "22:00" or a timestamp; turn them all into "10 PM – 11 PM"
        const ap = h => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
        const hourOf = v => { if (v == null || v === "" || isAll(v)) return null; if (typeof v === "number") return v % 24; const t = String(v);
          const m = /(\d{1,2})(?::\d{2})?\s*([ap])\.?m/i.exec(t); if (m) return (+m[1] % 12) + (/p/i.test(m[2]) ? 12 : 0);
          const iso = /T(\d{2}):\d{2}/.exec(t) || /^(\d{1,2}):\d{2}/.exec(t) || /^(\d{1,2})$/.exec(t.trim()); return iso ? +iso[1] % 24 : null; };
        data = { ...data, rows: data.rows.map(r => { const h = hourOf(r[hourCol]); return h == null ? r : { ...r, [hourCol]: `${ap(h)} – ${ap((h + 1) % 24)}` }; }) };
        const startH = v => { const h = hourOf(v); return h == null ? 99 : h; };
        const shEnd = (await getShift()).end || "22:10", endH = +String(shEnd).split(":")[0];   // normal shift ends 10:10 PM PT → 1 hr = 10–11 PM
        const order = v => (startH(v) - endH + 24) % 24;
        slots = [...new Set(data.rows.map(r => r[hourCol]).filter(v => v && !isAll(v)))].sort((a, b) => order(a) - order(b));
        const slot = Math.max(0, Math.min(slots.length, parseInt(req.query.slot || "0", 10) || 0));
        const hasAll = data.rows.some(r => isAll(r[hourCol]));
        data = { ...data, cols: data.cols.filter(k => k !== hourCol), rows: data.rows.filter(r => slot ? r[hourCol] === slots[slot - 1] : (hasAll ? isAll(r[hourCol]) : !isAll(r[hourCol]))) };
      }
      const taskCols = data.cols.filter(k => k !== nameCol && k !== dateCol && k !== totalCol && k !== teamCol && data.rows.some(r => r[k] !== null && r[k] !== "" && Number.isFinite(num(r[k]))));
      // Oregon reviewers aren't on the PL list: never match them to a PL person by a similar name
      const matchRow = r => oregonRow(r) ? (roster.find(m => m.name.trim().toLowerCase() === String(r[nameCol] || "").trim().toLowerCase()) || null) : matchMember(r[nameCol], roster);
      // ?mine=1: one person's own numbers for every day the question returns (for "My metrics").
      if (req.query.mine) {
        const series = data.rows.filter(r => matchRow(r)?.id === me.id).map(r => {
          const values = Object.fromEntries(taskCols.map(k => [k, num(r[k]) || 0]));
          return { date: toDay(r[dateCol]), values, total: num(r[totalCol]) || Object.values(values).reduce((a, v) => a + v, 0) };
        }).filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date)).slice(-31);
        res.setHeader("Cache-Control", "no-store");
        return send(res, 200, { configured: true, today, columns: taskCols, series, fetchedAt: data.at });
      }
      // ?range=day|week|month with ?date= as the anchor day. Week = Monday–Sunday, month = calendar month (Manila).
      // Day defaults to today (even if Metabase has nothing yet); rows are summed per person over the period.
      const range = ["week", "month"].includes(req.query.range) ? req.query.range : "day";
      const plus = (k, n) => { const [y, mo, d] = k.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10); };
      const monday = k => { const [y, mo, d] = k.split("-").map(Number); return plus(k, -((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7)); };
      const anchor = range === "day" && !req.query.date ? today : day;
      const from = range === "week" ? monday(anchor) : range === "month" ? anchor.slice(0, 7) + "-01" : anchor;
      const to = range === "week" ? plus(from, 6) : range === "month" ? plus(plus(from, 32).slice(0, 7) + "-01", -1) : anchor;
      const byKey = new Map();
      for (const r of data.rows) {
        const dd = toDay(r[dateCol]); if (!dd || dd < from || dd > to) continue;
        const m = matchRow(r);
        if (!admin && !(m && team.has(m.id))) continue;
        const key = m?.id || "n:" + String(r[nameCol]).toLowerCase();
        const cur = byKey.get(key) || { memberId: m?.id || null, name: r[nameCol], team: oregonRow(r) ? "Oregon" : (mbTeam(r) || null), values: Object.fromEntries(taskCols.map(k => [k, 0])), total: 0, days: new Set() };
        taskCols.forEach(k => { cur.values[k] += num(r[k]) || 0; });
        cur.total += num(r[totalCol]) || taskCols.filter(k => !/REJECT/i.test(k)).reduce((a, k) => a + (num(r[k]) || 0), 0);
        cur.days.add(dd); byKey.set(key, cur);
      }
      const rows = [...byKey.values()].map(r => ({ ...r, days: r.days.size }));
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, { configured: true, cardId: admin ? c.cardId : undefined, slots, overtime: ot, nextRefresh: data.at + 3600000, range, date: anchor, from, to, today, tz: manila ? "manila" : "pacific",
        days: days.slice(-120), columns: taskCols, rows, fetchedAt: data.at });
    }
    // Metrics: the Metabase dashboards this person may see, with fresh signed embed links (?metrics=1).
    if (req.method === "GET" && req.query.metrics) {
      const [row] = await sql`select value from settings where key = 'metrics'`;
      const lead = !!(await sql`select 1 from members where manager_id = ${me.id} limit 1`).length;
      const all = Array.isArray(row?.value) ? row.value : [];
      const items = all.filter(x => x.audience === "everyone" || admin || (x.audience === "leads" && lead)).map(x => ({
        id: x.id, name: x.name, kind: x.kind, audience: x.audience,
        url: x.kind === "public" ? x.ref : metabaseEmbedUrl(x.kind, x.ref),
        ...(admin ? { ref: x.ref } : {})
      }));
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, { items, configured: metabaseReady(), site: admin ? (MB_HOST() || "") : undefined });
    }
    // Timecards for one person (?card=<id>&from=&to=) and team range data (?from=&to=&team=1)
    if (req.method === "GET" && (req.query.card || req.query.team)) {
      const from = dayOk(req.query.from) ? req.query.from : null, to = dayOk(req.query.to) ? req.query.to : null;
      if (req.query.card) {
        const id = String(req.query.card);
        if (id !== me.id && !admin) { const [x] = await sql`select 1 from members where id = ${id} and manager_id = ${me.id}`; if (!x) return fail(res, 403, "Not your team."); }
        const rows = await sql`select id, member_id as "memberId", to_char(day, 'YYYY-MM-DD') as day,
          round(extract(epoch from clock_in) * 1000)::float8 as "in", round(extract(epoch from clock_out) * 1000)::float8 as "out",
          breaks, break_min as "breakMin", note, edited, kind, approval, approval_note as "approvalNote", late, left_early as "leftEarly", device_in as "deviceIn", device_out as "deviceOut", round(extract(epoch from count_from) * 1000)::float8 as "countFrom", late_by as "lateBy", early_by as "earlyBy", clock_out is null as open from shifts
          where member_id = ${id} and (${from}::date is null or day >= ${from}::date) and (${to}::date is null or day <= ${to}::date)
          order by clock_in desc limit 500`;
        return send(res, 200, { card: rows });
      }
      if (!from || !to) return fail(res, 400, "Pick a range.");
      const rows = await sql`select id, member_id as "memberId", to_char(day, 'YYYY-MM-DD') as day,
          round(extract(epoch from clock_in) * 1000)::float8 as "in", round(extract(epoch from clock_out) * 1000)::float8 as "out",
          breaks, break_min as "breakMin", note, edited, kind, approval, approval_note as "approvalNote", late, left_early as "leftEarly", device_in as "deviceIn", device_out as "deviceOut", round(extract(epoch from count_from) * 1000)::float8 as "countFrom", late_by as "lateBy", early_by as "earlyBy", clock_out is null as open from shifts
        where day between ${from}::date and ${to}::date and day <= ${from}::date + 62
          and (${admin} or member_id = ${me.id} or member_id in (select id from members where manager_id = ${me.id}))`;
      const sch = await sql`select member_id as "memberId", to_char(day, 'YYYY-MM-DD') as day, codes from schedules
        where day between ${from}::date and ${to}::date and (${admin} or member_id = ${me.id} or member_id in (select id from members where manager_id = ${me.id}))`;
      return send(res, 200, { rangeShifts: rows, rangeSched: sch });
    }
    if (req.method === "GET" && req.query.history) {
      const id = String(req.query.history);
      if (!admin && id !== me.id) return fail(res, 403, "You can only see your own history.");
      const rows = await sql`select h.field, h.old_value as "old", h.new_value as "new", m.name as "by",
        round(extract(epoch from h.changed_at) * 1000)::float8 as at from member_history h left join members m on m.id = h.changed_by
        where h.member_id = ${id} order by h.changed_at desc limit 200`;
      return send(res, 200, { history: rows });
    }
    if (req.method === "GET") {
      // All queries below run in parallel (one round trip of waiting instead of ~15).
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: PAY_TZ }).format(new Date());
      const week = dayOk(req.query.week) ? req.query.week : today;
      const only = admin ? null : me.id;
      // Everyone sees the org chart (names, titles, departments). Contact info and sign-in status are admin-only;
      // level, tier and start date are visible to admins and to the person themselves.
      const members$ = admin
        ? sql`select id, name, email, phone, dept, role, active, pin_hash is not null as "hasPin", round(extract(epoch from invited_at) * 1000)::float8 as "invitedAt",
            manager_id as "managerId", rung, tier, to_char(start_date, 'YYYY-MM-DD') as "startDate",
            job_title as "jobTitle", leave_days as "leaveDays", employment_type as "employmentType", work_location as "workLocation", personal_email as "personalEmail", coalesce(meet_link, case when lower(email) = 'alan@arenaclub.com' then 'https://meet.google.com/ara-qmvp-frj' end) as "meetLink", anytime_off as "anytimeOff", default_codes as "repeatCodes", pay_type as "payType", overtime,
            salary::float8 as salary, allowance::float8 as allowance , round(extract(epoch from photo_at) * 1000)::float8 as "photoV", org_solo as "orgSolo" from members order by name`
        : sql`select id, name, dept, role, active, manager_id as "managerId",
            rung, case when id = ${me.id} then tier end as tier,
            case when id = ${me.id} then to_char(start_date, 'YYYY-MM-DD') end as "startDate",
            job_title as "jobTitle", case when id = ${me.id} then leave_days end as "leaveDays",
            round(extract(epoch from photo_at) * 1000)::float8 as "photoV", org_solo as "orgSolo",
            work_location as "workLocation", employment_type as "employmentType",
            case when id = ${me.id} then email end as email, case when id = ${me.id} then phone end as phone,
            case when id = ${me.id} then personal_email end as "personalEmail",
            case when id = ${me.id} then pay_type end as "payType", case when id = ${me.id} then overtime end as overtime
            from members where active order by name`;
      const live$ = sql`select id, member_id as "memberId", to_char(day, 'YYYY-MM-DD') as day,
        round(extract(epoch from clock_in) * 1000)::float8 as "in", round(extract(epoch from clock_out) * 1000)::float8 as "out",
        breaks, break_min as "breakMin", note, edited, kind, approval, approval_note as "approvalNote", late, left_early as "leftEarly", device_in as "deviceIn", device_out as "deviceOut", round(extract(epoch from count_from) * 1000)::float8 as "countFrom", late_by as "lateBy", early_by as "earlyBy", clock_out is null as open from shifts
        where (day >= (${today}::date - 1) or clock_out is null) and (${only}::uuid is null or member_id = ${only})`;
      const weekShifts$ = sql`select id, member_id as "memberId", to_char(day, 'YYYY-MM-DD') as day,
        round(extract(epoch from clock_in) * 1000)::float8 as "in", round(extract(epoch from clock_out) * 1000)::float8 as "out",
        breaks, break_min as "breakMin", note, edited, kind, approval, approval_note as "approvalNote", late, left_early as "leftEarly", device_in as "deviceIn", device_out as "deviceOut", round(extract(epoch from count_from) * 1000)::float8 as "countFrom", late_by as "lateBy", early_by as "earlyBy", clock_out is null as open from shifts
        where day between ${week}::date and (${week}::date + 6) and (${only}::uuid is null or member_id = ${only})`;
      const myWeek$ = sql`select id, member_id as "memberId", to_char(day, 'YYYY-MM-DD') as day,
        round(extract(epoch from clock_in) * 1000)::float8 as "in", round(extract(epoch from clock_out) * 1000)::float8 as "out",
        breaks, break_min as "breakMin", note, edited, kind, approval, approval_note as "approvalNote", late, left_early as "leftEarly", device_in as "deviceIn", device_out as "deviceOut", round(extract(epoch from count_from) * 1000)::float8 as "countFrom", late_by as "lateBy", early_by as "earlyBy", clock_out is null as open from shifts
        where member_id = ${me.id} and day between date_trunc('week', ${today}::date)::date and date_trunc('week', ${today}::date)::date + 6`;
      // Admins see everyone’s time off; team members see their own. Old requests drop off after 90 days.
      const timeOff$ = sql`select id, member_id as "memberId", type, to_char(start_date, 'YYYY-MM-DD') as start,
        to_char(end_date, 'YYYY-MM-DD') as "end", note, status, decision_note as "decisionNote",
        round(extract(epoch from created_at) * 1000)::float8 as created, round(extract(epoch from decided_at) * 1000)::float8 as "decidedAt",
        decided_by as "decidedBy"
        from time_off where end_date >= least(${today}::date - 90, date_trunc('year', ${today}::date)::date) and (${only}::uuid is null or member_id = ${only})
        order by start_date`;
      // Time Overview timeline (admins): every shift that overlaps the day being viewed, in the viewer’s time zone.
      let timeline = [];
      const tlStart = Number(req.query.tlStart), tlEnd = Number(req.query.tlEnd);
      if (admin && Number.isFinite(tlStart) && Number.isFinite(tlEnd) && tlEnd > tlStart && tlEnd - tlStart <= 32 * 86400e3) {
        timeline = sql`select id, member_id as "memberId", to_char(day, 'YYYY-MM-DD') as day,
          round(extract(epoch from clock_in) * 1000)::float8 as "in", round(extract(epoch from clock_out) * 1000)::float8 as "out",
          breaks, break_min as "breakMin", note, edited, kind, approval, approval_note as "approvalNote", late, left_early as "leftEarly", device_in as "deviceIn", device_out as "deviceOut", round(extract(epoch from count_from) * 1000)::float8 as "countFrom", late_by as "lateBy", early_by as "earlyBy", clock_out is null as open from shifts
          where clock_in < to_timestamp(${tlEnd / 1000}) and coalesce(clock_out, now()) > to_timestamp(${tlStart / 1000})`;
      }
      // Today’s schedule codes (5H, 6H, OS, NS): admins get everyone’s, team members their own.
      const schedRows$ = sql`select member_id as "memberId", codes from schedules where day = ${today}::date and (${only}::uuid is null or member_id = ${only})`;
      // 1:1s, reviews and updates. Managers (anyone with reports) see their own; admins see all.
      const ms$ = sql`select id, manager_id as "managerId", member_id as "memberId", round(extract(epoch from starts_at) * 1000)::float8 as at,
        duration_min as "durationMin", repeat, status, points, notes, actions, link,
        case when ${admin} or manager_id = ${me.id} then private_notes else null end as "privateNotes"
        from meetings where (${admin} or manager_id = ${me.id} or member_id = ${me.id}) and starts_at > now() - interval '150 days'
        order by starts_at`;
      const cycles$ = sql`select id, name, to_char(period_start, 'YYYY-MM-DD') as "periodStart", to_char(period_end, 'YYYY-MM-DD') as "periodEnd",
        to_char(due, 'YYYY-MM-DD') as due, to_char(review_due, 'YYYY-MM-DD') as "reviewDue", status, kind from review_cycles order by created_at desc`;
      const rv$ = sql`select id, cycle_id as "cycleId", member_id as "memberId", reviewer_id as "reviewerId", status, self_text as "selfText", self_rating as "selfRating", self_answers as "selfAnswers",
        round(extract(epoch from self_sent_at) * 1000)::float8 as "selfSentAt", round(extract(epoch from self_submitted_at) * 1000)::float8 as "selfSubmittedAt",
        case when ${admin} or reviewer_id = ${me.id} or status = 'shared' then mgr_answers end as "mgrAnswers",
        case when ${admin} or reviewer_id = ${me.id} or status = 'shared' then extra_info end as "extra",
        round(extract(epoch from updated_at) * 1000)::float8 as "updatedAt", round(extract(epoch from shared_at) * 1000)::float8 as "sharedAt",
        case when ${admin} or reviewer_id = ${me.id} or status = 'shared' then rating end as rating,
        case when ${admin} or reviewer_id = ${me.id} or status = 'shared' then strengths end as strengths,
        case when ${admin} or reviewer_id = ${me.id} or status = 'shared' then growth end as growth,
        case when ${admin} or reviewer_id = ${me.id} or status = 'shared' then goals end as goals
        from reviews where ${admin} or member_id = ${me.id} or reviewer_id = ${me.id}`;
      const ups$ = sql`select id::text, member_id as "memberId", author_id as "authorId", kind, body, shared,
        round(extract(epoch from created_at) * 1000)::float8 as at from person_updates
        where ${admin} or author_id = ${me.id} or (member_id = ${me.id} and shared) or member_id in (select id from members where manager_id = ${me.id})
        order by created_at desc limit 400`;
      // Announcements expire after 7 days: older ones are hidden here and deleted whenever a new one is posted.
      const announcements$ = sql`select a.id::text, a.author_id as "authorId", a.body, a.image, round(extract(epoch from a.created_at) * 1000)::float8 as at
        from announcements a where a.created_at >= now() - interval '7 days' order by a.created_at desc limit 50`;
      const shift$ = getShift();
      const notifications$ = sql`select id::text, kind, title, body, link, ref_id as "refId", read_at is not null as read,
        round(extract(epoch from created_at) * 1000)::float8 as at from notifications where member_id = ${me.id} order by created_at desc limit 30`;
      // My Time calendar: the person’s own shifts for one month (?cal=YYYY-MM).
      let myMonth = [];
      if (/^\d{4}-\d{2}$/.test(req.query.cal || "")) {
        const first = req.query.cal + "-01";
        myMonth = sql`select id, member_id as "memberId", to_char(day, 'YYYY-MM-DD') as day,
          round(extract(epoch from clock_in) * 1000)::float8 as "in", round(extract(epoch from clock_out) * 1000)::float8 as "out",
          breaks, break_min as "breakMin", note, edited, kind, approval, approval_note as "approvalNote", late, left_early as "leftEarly", device_in as "deviceIn", device_out as "deviceOut", round(extract(epoch from count_from) * 1000)::float8 as "countFrom", late_by as "lateBy", early_by as "earlyBy", clock_out is null as open from shifts
          where member_id = ${me.id} and day >= ${first}::date and day < (${first}::date + interval '1 month')::date`;
      }
      const [members, live, weekShifts, myWeek, timeOff, schedRows, ms, cycles, rv, ups, announcements, notifications, shift, timelineRows, myMonthRows, rev] = await Promise.all([members$, live$, weekShifts$, myWeek$, timeOff$, schedRows$, ms$, cycles$, rv$, ups$, announcements$, notifications$, shift$, timeline, myMonth, getRev()]);
      res.setHeader("Cache-Control", "no-store");
      timeline = timelineRows; myMonth = myMonthRows;
      const schedToday = Object.fromEntries(schedRows.map(r => [r.memberId, r.codes]));
      const swapEvRecomp = ((await sql`select value from settings where key = 'swap_ev_recomp'`)[0]?.value ?? true) === true;
      const idleSignout = +((await sql`select value from settings where key = 'idle_signout'`)[0]?.value || 0);
      const reviewQuestions = (await sql`select value from settings where key = 'review_questions'`)[0]?.value || null;
      const metricsTeams = (await sql`select value from settings where key = 'metrics_teams'`)[0]?.value || {};
      const demoOnLogin = admin ? ((await sql`select value from settings where key = 'demo_on_login'`)[0]?.value === true) : false;
      const deleted = admin ? ((await sql`select value from settings where key = 'deleted_people'`)[0]?.value || []) : [];
      return send(res, 200, { swapEvRecomp, idleSignout, reviewQuestions, metricsTeams, demoOnLogin, deleted, rev, me, today, now: Date.now(), members, live, week: weekShifts, myWeek, myMonth, timeOff, timeline, schedToday, mySchedule: schedToday[me.id] || [], shift, notifications, meetings: ms, cycles, reviews: rv, updates: ups, announcements });
    }

    if (req.method !== "POST") return fail(res, 405, "Method not allowed");
    const b = await body(req);
    // Any write tells every open browser to refresh (except marking your own notifications read).
    if (!["notifRead"].includes(b.op)) await bumpRev();
    const now = Date.now();

    if (b.op === "clock") {
      const mid = b.memberId;
      if (!admin && mid !== me.id) return fail(res, 403, "You can only clock yourself in and out.");
      // Computers only: people clock themselves in and out from a laptop or desktop (admins fixing someone else's punch can use any device).
      const device = deviceOf(req, b), phone = device !== "Computer";
      if (phone && mid === me.id) {
        const sh0 = await getShift();
        if (sh0.desktopOnly) {
          const [w0] = await sql`select dept, role from members where id = ${mid}`;
          const okMobile = (sh0.mobileDepts || []).includes(w0?.dept) || ((sh0.mobileDepts || []).includes("Admins") && w0?.role === "admin");
          if (!okMobile) return fail(res, 403, "Clock in and out from a laptop or desktop computer. You can still view your time on your phone.");
        }
      }
      const s = await openShift(mid);
      if (b.kind === "in") {
        if (s) return fail(res, 409, "Already clocked in.");
        // Normal shift: team members can only clock in inside the window admins set. Admins are exempt.
        const [sch] = await sql`select codes from schedules where member_id = ${mid} and day = (now() at time zone ${PAY_TZ})::date`;
        const shiftNow = await getShift();
        const [who] = await sql`select dept, role, anytime_off from members where id = ${mid}`;
        const flex = (shiftNow.flexDepts || []).includes(who?.dept) || ((shiftNow.flexDepts || []).includes("Admins") && who?.role === "admin" && !who?.anytime_off);
        // Any-time people (CS team, admins) never get Late or a blocked clock-in, but a session in a habit window
        // (5H / 6H / NS) is still recorded as that habit, not as a normal shift.
        const hab = flex ? clockInCheck({ ...shiftNow, enabled: true }, Date.now(), ["5H", "6H", "NS"].filter(c => shiftNow.habits?.[c]?.time && shiftNow.habits?.[c]?.enabled !== false)) : null;
        const chk = flex ? { ok: true, late: false, habit: hab?.ok && hab.habit ? hab.habit : null } : clockInCheck(shiftNow, Date.now(), sch?.codes || []);
        if (!chk.ok && !admin) return fail(res, 403, chk.message);
        try {
          await sql`insert into shifts (member_id, day, clock_in, late, kind, count_from, late_by, device_in) values (${mid}, (now() at time zone ${PAY_TZ})::date, now(), ${!!chk.late}, ${chk.habit || null},
            ${chk.countFrom ? new Date(chk.countFrom).toISOString() : null}, ${chk.lateBy || null}, ${device})`;
        } catch (e) { if (e.code === "23505") return fail(res, 409, "Already clocked in."); throw e; }
        if (chk.late) await tellManager(mid, `clocked in ${chk.lateBy} min late`, chk.habit ? (shiftNow.habits?.[chk.habit]?.label || chk.habit) : "Normal shift", chk.start);
        return send(res, 200, { ok: true });
      }
      if (!s) return fail(res, 409, "Not clocked in.");
      const breaks = s.breaks || [];
      const onBreak = breaks.some(x => x.e == null);
      if (b.kind === "break" || b.kind === "lunch") {
        if (onBreak) return fail(res, 409, "Already on a break.");
        breaks.push({ s: now, e: null, t: b.kind, ds: device }); // t: "break" or "lunch"; ds/de: device used to start / end it
        await sql`update shifts set breaks = ${JSON.stringify(breaks)}::jsonb, updated_at = now() where id = ${s.id}`;
      } else if (b.kind === "back") {
        if (!onBreak) return fail(res, 409, "Not on break.");
        await sql`update shifts set breaks = ${JSON.stringify(breaks.map(x => x.e == null ? { ...x, e: now, de: device } : x))}::jsonb, updated_at = now() where id = ${s.id}`;
      } else if (b.kind === "out") {
        const [row] = await sql`select extract(epoch from clock_in)::float8 * 1000 as in_ms, kind from shifts where id = ${s.id}`;
        const sh = await getShift();
        const [who] = await sql`select dept from members where id = ${mid}`;
        const [sc] = await sql`select codes from schedules where member_id = ${mid} and day = (select day from shifts where id = ${s.id})`;
        const [wr] = await sql`select role, anytime_off from members where id = ${mid}`;
        const by = (sh.flexDepts || []).includes(who?.dept) || ((sh.flexDepts || []).includes("Admins") && wr?.role === "admin" && !wr?.anytime_off) || ((sc?.codes || []).includes("CS") && sh.habits?.CS?.enabled !== false) ? 0 : earlyOutBy(sh, row.in_ms, now, row.kind || null);
        await sql`update shifts set breaks = ${JSON.stringify(breaks.map(x => x.e == null ? { ...x, e: now } : x))}::jsonb,
          clock_out = now(), left_early = ${by > 0}, early_by = ${by || null}, device_out = ${device}, updated_at = now() where id = ${s.id}`;
        if (by > 0) await tellManager(mid, `clocked out ${by} min early`, row.kind ? (sh.habits?.[row.kind]?.label || row.kind) : "Normal shift", null);
      } else return fail(res, 400, "Unknown action");
      return send(res, 200, { ok: true });
    }

    // ----- 1:1s / reviews / updates (admins, or the person's manager) -----
    const manages = async id => admin || !!(await sql`select 1 from members where id = ${id} and manager_id = ${me.id}`).length;
    const fmtWhen = ms => new Date(ms).toLocaleString("en-US", { timeZone: PAY_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " Manila";
    const cleanList = (arr, keys) => (Array.isArray(arr) ? arr : []).slice(0, 60).map(x => Object.fromEntries(keys.map(k => [k, k === "done" ? !!x[k] : String(x[k] ?? "").slice(0, 300)])));
    if (b.op === "photoSet") {
      const who = b.memberId || me.id;
      if (who !== me.id && !admin) return fail(res, 403, "You can only change your own photo.");
      const data = b.data == null ? null : String(b.data);
      if (data && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > 400_000)) return fail(res, 400, "Use a JPG or PNG under 300 KB.");
      await sql`update members set photo = ${data}, photo_at = case when ${!!data} then now() else null end where id = ${who}`;
      await sql`insert into member_history (member_id, field, old_value, new_value, changed_by) values (${who}, 'photo', null, ${data ? "updated" : "removed"}, ${me.id})`;
      return send(res, 200, { ok: true });
    }
    if (b.op === "shiftApprove") {
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).filter(Boolean).slice(0, 500);
      const status = ["approved", "rejected", "pending"].includes(b.status) ? b.status : null;
      if (!ids.length || !status) return fail(res, 400, "Nothing to update.");
      const rows = await sql`select s.id, s.member_id, to_char(s.day, 'Dy, Mon DD') as d, m.manager_id from shifts s join members m on m.id = s.member_id where s.id = any(${ids}::uuid[])`;
      if (!admin && rows.some(r => r.manager_id !== me.id)) return fail(res, 403, "You can only approve your own team’s timecards.");
      await sql`update shifts set approval = ${status}, approved_by = ${me.id}, approved_at = now(), approval_note = ${String(b.note || "").slice(0, 200)}, updated_at = now() where id = any(${ids}::uuid[]) and clock_out is not null`;
      if (status === "rejected") for (const r of rows) await notify(r.member_id, { kind: "denied", title: `Your timecard for ${r.d} wasn’t approved`, body: String(b.note || ""), link: "#mytime" });
      return send(res, 200, { ok: true, count: rows.length });
    }
    if (b.op === "shiftRemove") {
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).filter(Boolean).slice(0, 500);
      const rows = await sql`select s.id, m.manager_id from shifts s join members m on m.id = s.member_id where s.id = any(${ids}::uuid[])`;
      if (!admin && rows.some(r => r.manager_id !== me.id)) return fail(res, 403, "You can only delete your own team’s timecards.");
      await sql`delete from shifts where id = any(${ids}::uuid[])`;
      return send(res, 200, { ok: true, count: rows.length });
    }
    if (b.op === "meetingCreate") {
      if (!(await manages(b.memberId))) return fail(res, 403, "You can only schedule 1:1s with your own team.");
      const at = Number(b.at); if (!Number.isFinite(at)) return fail(res, 400, "Pick a date and time.");
      const repeat = ["none", "weekly", "biweekly", "monthly"].includes(b.repeat) ? b.repeat : "none";
      const dur = Math.max(10, Math.min(180, Math.round(Number(b.durationMin) || 30)));
      const managerId = b.managerId && admin ? b.managerId : me.id;
      const points = b.point ? [{ text: String(b.point).slice(0, 300), by: me.name, done: false }] : [];
      const [mgrRow] = await sql`select meet_link, lower(email) as email from members where id = ${managerId}`;
      const usual = mgrRow?.meet_link || (mgrRow?.email === "alan@arenaclub.com" ? "https://meet.google.com/ara-qmvp-frj" : null);   // Alan's usual room
      const link = cleanLink(b.link) || (b.link ? null : usual);
      if (b.link && !cleanLink(b.link)) return fail(res, 400, "That meeting link doesn’t look right. Paste the full https://meet.google.com/… link.");
      await sql`insert into meetings (manager_id, member_id, starts_at, duration_min, repeat, points, created_by, link)
        values (${managerId}, ${b.memberId}, to_timestamp(${at / 1000}), ${dur}, ${repeat}, ${JSON.stringify(points)}::jsonb, ${me.id}, ${link})`;
      if (b.memberId !== me.id) await notify(b.memberId, { kind: "meeting", title: `${me.name} scheduled a 1:1 with you: ${fmtWhen(at)}`, body: link ? `Join: ${link}` : "", link: "#ones", footer: "Open PL Time Cards › Talent › 1:1s to see it." });
      return send(res, 200, { ok: true });
    }
    if (b.op === "meetingDelete") {
      // Delete a 1:1 (the whole series if it repeats). Only its manager or an admin.
      const [m] = await sql`select * from meetings where id = ${b.id}`;
      if (!m) return fail(res, 404, "That 1:1 is already gone.");
      if (!(admin || m.manager_id === me.id)) return fail(res, 403, "Only the manager can delete this 1:1.");
      await sql`delete from meetings where id = ${b.id}`;
      const other = m.member_id === me.id ? m.manager_id : m.member_id;
      if (other && other !== me.id && m.status === "scheduled" && new Date(m.starts_at).getTime() > Date.now()) await notify(other, { kind: "meeting", title: `${me.name} removed your 1:1 on ${fmtWhen(new Date(m.starts_at).getTime())}`, link: "#ones" });
      return send(res, 200, { ok: true });
    }
    if (b.op === "meetingUpdate") {
      const [m] = await sql`select * from meetings where id = ${b.id}`;
      if (!m) return fail(res, 404, "That 1:1 is gone.");
      const lead = admin || m.manager_id === me.id, attendee = m.member_id === me.id;
      if (!lead && !attendee) return fail(res, 403, "Not your 1:1.");
      const f = b.fields || {};
      if (f.link !== undefined && f.link && !cleanLink(f.link)) return fail(res, 400, "That meeting link doesn’t look right. Paste the full https://meet.google.com/… link.");
      if (!lead && (f.notes !== undefined || f.privateNotes !== undefined || f.at !== undefined || f.status !== undefined || f.repeat !== undefined || f.link !== undefined)) return fail(res, 403, "Only the manager can change that.");
      await sql`update meetings set
        link = case when ${f.link !== undefined} then ${cleanLink(f.link)} else link end,
        points = case when ${f.points !== undefined} then ${JSON.stringify(cleanList(f.points, ["text", "by", "done"]))}::jsonb else points end,
        actions = case when ${f.actions !== undefined} then ${JSON.stringify(cleanList(f.actions, ["text", "owner", "done"]))}::jsonb else actions end,
        notes = case when ${f.notes !== undefined} then ${String(f.notes ?? "").slice(0, 5000)} else notes end,
        private_notes = case when ${f.privateNotes !== undefined} then ${String(f.privateNotes ?? "").slice(0, 5000)} else private_notes end,
        starts_at = case when ${f.at !== undefined} then to_timestamp(${Number(f.at) / 1000 || 0}) else starts_at end,
        repeat = case when ${f.repeat !== undefined} then ${["none", "weekly", "biweekly", "monthly"].includes(f.repeat) ? f.repeat : "none"} else repeat end,
        status = case when ${f.status !== undefined} then ${["scheduled", "done", "cancelled"].includes(f.status) ? f.status : "scheduled"} else status end,
        updated_at = now() where id = ${b.id}`;
      // Finishing a repeating 1:1 books the next one, carrying over open action items.
      if (f.status === "done" && m.repeat !== "none") {
        const step = m.repeat === "weekly" ? "7 days" : m.repeat === "biweekly" ? "14 days" : "1 month";
        const [cur] = await sql`select actions from meetings where id = ${b.id}`;
        const carry = (cur.actions || []).filter(a => !a.done);
        await sql`insert into meetings (manager_id, member_id, starts_at, duration_min, repeat, actions, created_by, link)
          values (${m.manager_id}, ${m.member_id}, ${m.starts_at}::timestamptz + ${step}::interval, ${m.duration_min}, ${m.repeat}, ${JSON.stringify(carry)}::jsonb, ${me.id}, ${cleanLink(f.link) ?? m.link})`;   // same meeting link
      }
      if (f.at !== undefined && m.member_id !== me.id) await notify(m.member_id, { kind: "meeting", title: `${me.name} moved your 1:1 to ${fmtWhen(Number(f.at))}`, link: "#ones" });
      if (f.status === "cancelled" && m.member_id !== me.id) await notify(m.member_id, { kind: "cancelled", title: `${me.name} cancelled your 1:1 on ${fmtWhen(new Date(m.starts_at).getTime())}`, link: "#ones" });
      return send(res, 200, { ok: true });
    }
    if (b.op === "reviewSave") {
      const [r] = await sql`select * from reviews where id = ${b.id}`;
      if (!r) return fail(res, 404, "That review is gone.");
      const [cy] = await sql`select status, name from review_cycles where id = ${r.cycle_id}`;
      if (r.member_id === me.id && b.self) {
        if (cy.status !== "open") return fail(res, 400, "This review cycle is closed.");
        if (!r.self_sent_at) return fail(res, 403, "Your self review isn’t open yet. Your manager sends it when it’s time.");
        if (r.self_submitted_at) return fail(res, 409, "You already submitted your self review. Ask your manager to unlock it if you need to change something.");
        // Self review = answers to the questions (sent with their wording, so old reviews keep the questions they were asked).
        const answers = Array.isArray(b.answers) ? b.answers.slice(0, 10).map(x => ({ q: String(x?.q || "").slice(0, 400), a: String(x?.a || "").trim().slice(0, 4000) })).filter(x => x.q) : null;
        if (answers && answers.some(x => !x.a)) return fail(res, 400, "Answer every question before you submit.");
        const text = answers ? answers.map((x, i) => `${i + 1}. ${x.q}\n${x.a}`).join("\n\n") : String(b.selfText || "");
        await sql`update reviews set self_text = ${text.slice(0, 20000)}, self_answers = ${answers ? JSON.stringify(answers) : null}::jsonb,
          self_rating = ${Number.isInteger(b.selfRating) ? b.selfRating : null}, self_submitted_at = now(), updated_at = now() where id = ${b.id}`;
        if (r.reviewer_id) await notify(r.reviewer_id, { kind: "review", title: `${me.name} submitted their ${selfReviewName(cy.name)}`, link: "#reviews", footer: "Open PL Time Cards › Talent › Reviews to read it and write their review." });
        return send(res, 200, { ok: true });
      }
      if (!(admin || r.reviewer_id === me.id)) return fail(res, 403, "Only the reviewer can write this review.");
      // Nobody writes their own manager review (even an admin): they fill in the self review; their manager writes this part.
      if (r.member_id === me.id && r.reviewer_id !== me.id) return fail(res, 403, "Your manager writes this part. You fill in your self review.");
      const share = !!b.share;
      // Manager review = a 1–5 vote on each statement (sent with its wording); the overall rating is their average.
      const mgr = Array.isArray(b.answers) ? b.answers.slice(0, 12).map(x => ({ q: String(x?.q || "").slice(0, 400), rating: Number.isInteger(x?.rating) && x.rating >= 1 && x.rating <= 5 ? x.rating : null })).filter(x => x.q) : null;
      if (share && mgr && mgr.some(x => !x.rating)) return fail(res, 400, "Vote 1–5 on every statement before you send it.");
      const rated = mgr ? mgr.filter(x => x.rating) : [];
      const rating = mgr ? (rated.length ? Math.round(rated.reduce((a, x) => a + x.rating, 0) / rated.length) : null)
        : Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5 ? b.rating : null;
      if (mgr) await sql`update reviews set mgr_answers = ${JSON.stringify(mgr)}::jsonb where id = ${b.id}`;
      if (b.extra !== undefined) await sql`update reviews set extra_info = ${String(b.extra || "").slice(0, 8000)} where id = ${b.id}`;
      await sql`update reviews set rating = ${rating}, strengths = ${String(b.strengths || "").slice(0, 5000)}, growth = ${String(b.growth || "").slice(0, 5000)},
        goals = ${String(b.goals || "").slice(0, 5000)}, status = ${share ? "shared" : "draft"}, reviewer_id = coalesce(reviewer_id, ${me.id}),
        shared_at = case when ${share} then coalesce(shared_at, now()) else shared_at end, updated_at = now() where id = ${b.id}`;
      if (share && r.status !== "shared") await notify(r.member_id, { kind: "review", title: `Your ${/review/i.test(cy.name) ? cy.name : cy.name + " review"} from ${me.name} is ready`, link: "#reviews", footer: "Open PL Time Cards › Talent › Reviews to read it." });
      return send(res, 200, { ok: true });
    }
    if (b.op === "reviewSendSelf") {
      // Send (or resend) the self review to team members: in-app notification + email with the questions.
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).filter(Boolean).slice(0, 500);
      const rows = await sql`select r.id, r.member_id, r.reviewer_id, r.self_submitted_at, c.name, c.status, to_char(c.due, 'Mon DD') as due
        from reviews r join review_cycles c on c.id = r.cycle_id where r.id = any(${ids}::uuid[])`;
      if (!admin && rows.some(x => x.reviewer_id !== me.id)) return fail(res, 403, "You can only send self reviews to your own team.");
      const qs = Array.isArray(b.questions) ? b.questions.slice(0, 10).map(q => String(q).slice(0, 400)) : [];
      let sent = 0;
      for (const x of rows) {
        if (x.status !== "open" || x.self_submitted_at) continue;
        await sql`update reviews set self_sent_at = now() where id = ${x.id}`;
        await notify(x.member_id, { kind: "review", title: `Please complete your ${selfReviewName(x.name)}${x.due ? ` by ${x.due}` : ""}`, link: "#reviews",
          body: qs.length ? `Answer these ${qs.length} questions, with examples:\n\n${qs.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : "",
          footer: "Open PL Time Cards › Talent › Reviews to write it." });
        sent++;
      }
      return send(res, 200, { ok: true, sent });
    }
    if (b.op === "reviewUnsend") {
      // Take back a send: the self review (closes it again, answers so far are kept) or the manager review (back to a draft they can't see).
      const [x] = await sql`select r.member_id, r.reviewer_id, r.self_submitted_at, c.name, c.status from reviews r join review_cycles c on c.id = r.cycle_id where r.id = ${b.id}`;
      if (!x) return fail(res, 404, "That review is gone.");
      if (!admin && x.reviewer_id !== me.id) return fail(res, 403, "Only their reviewer or an admin can do that.");
      if (b.part === "self") {
        if (x.self_submitted_at) return fail(res, 400, "They already submitted it. Use Unlock to let them change it.");
        await sql`update reviews set self_sent_at = null, updated_at = now() where id = ${b.id}`;
      } else {
        await sql`update reviews set status = 'draft', shared_at = null, updated_at = now() where id = ${b.id} and status = 'shared'`;
      }
      return send(res, 200, { ok: true });
    }
    if (b.op === "reviewUnlockSelf") {
      // Let a team member change a submitted self review.
      const [x] = await sql`select r.member_id, r.reviewer_id, c.name, c.status from reviews r join review_cycles c on c.id = r.cycle_id where r.id = ${b.id}`;
      if (!x) return fail(res, 404, "That review is gone.");
      if (!admin && x.reviewer_id !== me.id) return fail(res, 403, "Only their reviewer or an admin can unlock it.");
      if (x.status !== "open") return fail(res, 400, "This review cycle is closed.");
      await sql`update reviews set self_submitted_at = null, self_sent_at = coalesce(self_sent_at, now()) where id = ${b.id}`;
      await notify(x.member_id, { kind: "review", title: `Your ${selfReviewName(x.name)} is unlocked so you can make changes`, link: "#reviews", footer: "Open PL Time Cards › Talent › Reviews, update it and submit again." });
      return send(res, 200, { ok: true });
    }
    if (b.op === "reviewSendMany") {
      // Send every finished draft (all statements voted) in one go.
      const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 500);
      const rows = await sql`select r.id, r.member_id, r.reviewer_id, r.status, r.mgr_answers, c.name from reviews r join review_cycles c on c.id = r.cycle_id where r.id = any(${ids}::uuid[])`;
      let sent = 0;
      for (const x of rows) {
        if (!(admin || x.reviewer_id === me.id) || x.status !== "draft") continue;
        const a = Array.isArray(x.mgr_answers) ? x.mgr_answers : [];
        if (!a.length || a.some(v => !v.rating)) continue;
        await sql`update reviews set status = 'shared', shared_at = coalesce(shared_at, now()), updated_at = now() where id = ${x.id}`;
        await notify(x.member_id, { kind: "review", title: `Your ${/review/i.test(x.name) ? x.name : x.name + " review"} from ${me.name} is ready`, link: "#reviews", footer: "Open PL Time Cards › Talent › Reviews to read it." });
        sent++;
      }
      return send(res, 200, { ok: true, sent });
    }
    if (b.op === "updateAdd") {
      if (!(await manages(b.memberId))) return fail(res, 403, "You can only add updates for your own team.");
      const body = String(b.body || "").trim().slice(0, 2000); if (!body) return fail(res, 400, "Write something first.");
      const kind = ["praise", "feedback", "note"].includes(b.kind) ? b.kind : "note";
      await sql`insert into person_updates (member_id, author_id, kind, body, shared) values (${b.memberId}, ${me.id}, ${kind}, ${body}, ${!!b.shared})`;
      if (b.shared && b.memberId !== me.id) await notify(b.memberId, { kind: kind === "praise" ? "approved" : "review", title: `${me.name} shared ${kind === "praise" ? "praise" : "an update"} with you`, body: body.slice(0, 200), link: "#reviews" });
      return send(res, 200, { ok: true });
    }
    if (b.op === "updateDelete") {
      const [u] = await sql`select author_id from person_updates where id = ${Number(b.id) || 0}`;
      if (!u) return fail(res, 404, "Already gone.");
      if (!admin && u.author_id !== me.id) return fail(res, 403, "Only the author can delete this.");
      await sql`delete from person_updates where id = ${Number(b.id) || 0}`;
      return send(res, 200, { ok: true });
    }
    if (b.op === "notifRead") {
      if (b.all) await sql`update notifications set read_at = now() where member_id = ${me.id} and read_at is null`;
      else await sql`update notifications set read_at = now() where member_id = ${me.id} and id = ${Number(b.id) || 0} and read_at is null`;
      return send(res, 200, { ok: true });
    }
    if (b.op === "setSchedule") {
      const shAllowed = await getShift();
      const allowed = ["5H", "6H", "CS", "OS", "NS"].filter(c => shAllowed.habits?.[c]?.enabled !== false);   // codes switched off in Time Clock Setup can't be set
      const codes = [...new Set((Array.isArray(b.codes) ? b.codes : []).filter(c => allowed.includes(c)))];
      // Team members set their own codes; admins can set anyone’s (e.g. turn on 5H so they can start at 5 AM).
      const who = b.memberId || me.id;
      if (!admin) return fail(res, 403, "Only admins can turn 5H, 6H, NS, CS or OS on or off.");
      const day = dayOk(b.day) && (admin || who !== me.id) ? b.day : null;
      await sql`insert into schedules (member_id, day, codes) values (${who}, coalesce(${day}::date, (now() at time zone ${PAY_TZ})::date), ${codes})
        on conflict (member_id, day) do update set codes = excluded.codes, auto = false, updated_at = now()`;
      // 🔁 Repeat every workday: these codes become their standing schedule from this day on (until changed or switched off)
      if (b.repeat !== undefined) {
        const from = day || (await sql`select (now() at time zone ${PAY_TZ})::date::text as d`)[0].d;
        await sql`update members set default_codes = ${b.repeat ? codes : []} where id = ${who}`;
        await sql`delete from schedules where member_id = ${who} and auto and day > ${from}::date`;
        await fillRepeatingSchedules(true);
      }
      return send(res, 200, { ok: true });
    }
    if (b.op === "toRequest") {
      const types = ["Vacation", "Sick leave", "Bereavement"];
      if (!types.includes(b.type)) return fail(res, 400, "Pick a type of time off.");
      if (!dayOk(b.start) || !dayOk(b.end) || b.end < b.start) return fail(res, 400, "Pick a first and last day.");
      const [{ ok, span }] = await sql`select ${b.start}::date >= (now() at time zone ${PAY_TZ})::date - 30 as ok, ${b.end}::date - ${b.start}::date + 1 as span`;
      if (!ok) return fail(res, 400, "Requests can go back at most 30 days. Ask your lead to fix older time.");
      if (span > 60) return fail(res, 400, "A single request can cover up to 60 days.");
      const [clash] = await sql`select 1 from time_off where member_id = ${me.id} and status in ('pending', 'approved')
        and start_date <= ${b.end}::date and end_date >= ${b.start}::date`;
      if (clash) return fail(res, 409, "You already have time off requested for some of those days.");
      await sql`insert into time_off (member_id, type, start_date, end_date, note) values (${me.id}, ${b.type}, ${b.start}, ${b.end}, ${String(b.note || "").slice(0, 200)})`;
      return send(res, 200, { ok: true });
    }
    if (b.op === "toCancel") {
      const [r] = await sql`select *, to_char(start_date, 'YYYY-MM-DD') as s, to_char(end_date, 'YYYY-MM-DD') as e from time_off where id = ${b.id}`;
      if (!r) return fail(res, 404, "That request is gone.");
      const mineOk = r.member_id === me.id && r.status === "pending";
      const adminOk = admin && ["pending", "approved"].includes(r.status);
      if (!mineOk && !adminOk) return fail(res, 403, "Only pending requests can be cancelled. Ask your lead.");
      await sql`update time_off set status = 'cancelled', decided_by = ${me.id}, decided_at = now() where id = ${b.id}`;
      if (r.member_id !== me.id) {
        const range = rangeText(r.s, r.e);
        await notify(r.member_id, { kind: "cancelled", title: `Your ${r.type} (${range}) was cancelled by ${me.name}`, body: String(b.note || ""), link: "#mytime-requests", refId: r.id });
      }
      return send(res, 200, { ok: true });
    }

    // Account settings: anyone can update their own name, mobile number and personal email.
    // Work email (sign-in), department, role and the rest stay with admins.
    if (b.op === "selfUpdate") {
      const f = b.fields || {};
      const name = f.name != null ? String(f.name).trim().slice(0, 60) : undefined;
      const phone = f.phone != null ? normPhone(f.phone) : undefined;
      const pe = f.personalEmail != null ? normEmail(f.personalEmail) : undefined;
      const ml = f.meetLink != null ? (String(f.meetLink).trim() ? cleanLink(f.meetLink) : "") : undefined;
      if (ml === null) return fail(res, 400, "That meeting link doesn’t look right. Paste the full https://meet.google.com/… link.");
      if (ml !== undefined) await sql`update members set meet_link = ${ml || null} where id = ${me.id}`;
      if (name !== undefined && !name) return fail(res, 400, "Name is required.");
      if (phone && !phoneOk(phone)) return fail(res, 400, "Enter your mobile number with country code, like +63 917 123 4567.");
      if (pe && !emailOk(pe)) return fail(res, 400, "That personal email doesn’t look right.");
      const [before] = await sql`select name, phone, personal_email as "personalEmail" from members where id = ${me.id}`;
      await sql`update members set name = coalesce(${name ?? null}, name),
        phone = case when ${phone !== undefined} then ${phone || null} else phone end,
        personal_email = case when ${pe !== undefined} then ${pe || null} else personal_email end
        where id = ${me.id}`;
      const after = { name: name ?? before.name, phone: phone !== undefined ? (phone || null) : before.phone, personalEmail: pe !== undefined ? (pe || null) : before.personalEmail };
      for (const k of Object.keys(after))
        if ((before[k] ?? null) !== (after[k] ?? null))
          await sql`insert into member_history (member_id, field, old_value, new_value, changed_by) values (${me.id}, ${k}, ${before[k] ?? null}, ${after[k] ?? null}, ${me.id})`;
      return send(res, 200, { ok: true });
    }

    // Managers can add or edit timecard entries for their own team.
    let leadOk = false;
    if (!admin && b.op === "shiftSave") {
      const target = b.id ? (await sql`select member_id from shifts where id = ${b.id}`)[0]?.member_id : b.memberId;
      leadOk = !!target && target !== me.id && await manages(target);
    }
    if (!admin && !leadOk) return fail(res, 403, "Only admins can do that.");

    switch (b.op) {
      case "shiftSave": {
        const inMs = Number(b.in), outMs = b.out == null ? null : Number(b.out);
        const brk = Math.max(0, Math.round(Number(b.breakMin) || 0));
        if (!Number.isFinite(inMs)) return fail(res, 400, "Clock in is required.");
        if (outMs != null && (outMs <= inMs || outMs - inMs > 24 * 3600e3)) return fail(res, 400, "Clock out has to be after clock in and within 24 hours.");
        const note = String(b.note || "").slice(0, 140);
        const kindSet = b.kind !== undefined, kind = ["5H", "6H", "NS"].includes(b.kind) ? b.kind : null;   // Edit shift › Shift type
        const inTs = new Date(inMs).toISOString(), outTs = outMs == null ? null : new Date(outMs).toISOString();
        // Break 1 / Lunch / Break 2 … with their own start and end times (instead of a minutes total).
        let brks = null;
        if (Array.isArray(b.breaks)) {
          const lim = outMs ?? inMs + 24 * 3600e3;
          brks = b.breaks.slice(0, 8).map(x => ({ s: Number(x.s), e: x.e == null || x.e === "" ? null : Number(x.e), t: x.t === "lunch" ? "lunch" : "break",
            ...(x.ds ? { ds: String(x.ds).slice(0, 20) } : {}), ...(x.de ? { de: String(x.de).slice(0, 20) } : {}) })).sort((p, q) => p.s - q.s);
          for (const [i, x] of brks.entries()) {
            if (!Number.isFinite(x.s) || x.s < inMs || x.s > lim) return fail(res, 400, `${x.t === "lunch" ? "Lunch" : "Break"} ${i + 1} has to start during the shift.`);
            if (x.e == null && (outMs != null || i !== brks.length - 1)) return fail(res, 400, `Add an end time for ${x.t === "lunch" ? "lunch" : "break"} ${i + 1}.`);
            if (x.e != null && (!Number.isFinite(x.e) || x.e <= x.s || x.e > lim)) return fail(res, 400, `${x.t === "lunch" ? "Lunch" : "Break"} ${i + 1} has to end after it starts and before clock out.`);
            if (i && brks[i - 1].e != null && x.s < brks[i - 1].e) return fail(res, 400, "Breaks can’t overlap.");
          }
        }
        try {
          if (b.id) {
            if (brks) await sql`update shifts set breaks = ${JSON.stringify(brks)}::jsonb where id = ${b.id}`;
            await sql`update shifts set clock_in = ${inTs}, clock_out = ${outTs}, day = (${inTs}::timestamptz at time zone ${PAY_TZ})::date,
              break_min = ${brks ? null : brk}, note = ${note}, edited = true, updated_at = now(), count_from = null,
              kind = case when ${kindSet} then ${kind} else kind end,
              breaks = (select coalesce(jsonb_agg(case when (x->>'e') is null and ${outTs}::timestamptz is not null
                then x || jsonb_build_object('e', ${outMs}::float8) else x end), '[]'::jsonb) from jsonb_array_elements(breaks) x),
              approval = case when ${outTs}::timestamptz is not null then 'approved' else approval end, approved_by = ${me.id}, approved_at = now()
              where id = ${b.id}`;
          } else {
            if (!b.memberId) return fail(res, 400, "Pick a team member.");
            await sql`insert into shifts (member_id, day, clock_in, clock_out, break_min, breaks, note, edited, kind, approval, approved_by, approved_at)
              values (${b.memberId}, (${inTs}::timestamptz at time zone ${PAY_TZ})::date, ${inTs}, ${outTs}, ${brks ? null : brk}, ${JSON.stringify(brks || [])}::jsonb, ${note}, true,
                ${kind}, ${outTs ? "approved" : "pending"}, ${me.id}, now())`;
          }
        } catch (e) { if (e.code === "23505") return fail(res, 409, "This person already has an open shift."); throw e; }
        return send(res, 200, { ok: true });
      }
      case "shiftSettings": {
        const v = b.shift || {};
        const hm = x => typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
        if (!hm(v.start) || !hm(v.end) || v.start === v.end) return fail(res, 400, "Enter a start and end time.");
        const days = [...new Set((v.days || []).map(Number))].filter(d => d >= 1 && d <= 7).sort();
        if (!days.length) return fail(res, 400, "Pick at least one workday.");
        const earlyMin = Math.round(Number(v.earlyMin)), lateMin = Math.round(Number(v.lateMin)), earlyOutMin = Math.round(Number(v.earlyOutMin ?? 5));
        if (!(earlyMin >= 0 && earlyMin <= 180) || !(lateMin >= 0 && lateMin <= 120) || !(earlyOutMin >= 0 && earlyOutMin <= 120)) return fail(res, 400, "Minutes must be 0–180 before, 0–120 grace for late and 0–120 for clocking out early.");
        const habits = {};
        for (const code of ["5H", "6H", "CS", "OS", "NS"]) {
          const h = (v.habits || {})[code] || {};
          if (h.time != null && h.time !== "" && !hm(h.time)) return fail(res, 400, `Enter a valid clock-in time for ${code}.`);
          if (h.end != null && h.end !== "" && !hm(h.end)) return fail(res, 400, `Enter a valid clock-out time for ${code}.`);
          const afterMin = Math.round(Number(h.afterMin ?? 60));
          if (!(afterMin >= 5 && afterMin <= 600)) return fail(res, 400, `${code}: the window must stay open 5 to 600 minutes.`);
          const on = ["CS", "OS", "NS"].includes(code) ? h.enabled !== false : true;
          habits[code] = code === "CS" ? { label: String(h.label || "Customer Service").trim().slice(0, 30) || "Customer Service", time: null, afterMin: 60, anytime: true, enabled: on }
            : { label: String(h.label || code).trim().slice(0, 30) || code, time: h.time || null, end: h.time && h.end ? h.end : null, afterMin, enabled: on };
        }
        const flexDepts = [...new Set((Array.isArray(v.flexDepts) ? v.flexDepts : []).filter(x => DEPTS.includes(x) || x === "Admins"))];   // "Admins" = everyone with the admin role
        const anchor = v.anchor === "America/Los_Angeles" ? "America/Los_Angeles" : "Asia/Manila";
        const mobileDepts = [...new Set((Array.isArray(v.mobileDepts) ? v.mobileDepts : []).filter(x => DEPTS.includes(x) || x === "Admins"))];
        const value = { ...DEFAULT_SHIFT, enabled: !!v.enabled, block: !!v.block, start: v.start, end: v.end, days, earlyMin, lateMin, earlyOutMin, habits, flexDepts, anchor,
          desktopOnly: v.desktopOnly !== false, mobileDepts };
        await sql`insert into settings (key, value) values ('shift', ${JSON.stringify(value)}::jsonb)
          on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return send(res, 200, { ok: true });
      }
      case "importRoster": {
        // Adds or updates team members by email in one go. Runs again safely: existing people are updated, not duplicated.
        const rows = Array.isArray(b.rows) ? b.rows.slice(0, 400) : [];
        const clean = [], skipped = [];
        const [dl] = await sql`select value from settings where key = 'deleted_people'`;
        const gone = new Set((dl?.value || []).map(x => String(x.email || "").toLowerCase()));
        for (const r of rows) {
          if (gone.has(normEmail(r.email))) { skipped.push(`${String(r.name || r.email).trim()} (deleted)`); continue; }
          const email = normEmail(r.email), name = String(r.name || "").trim().slice(0, 60);
          if (!name || !emailOk(email) || !DEPTS.includes(r.dept)) { skipped.push(name || email || "row"); continue; }
          const rung = Number.isInteger(r.rung) && r.rung >= 0 && r.rung <= 10 ? r.rung : null;
          const tier = ["Prime", "Pro", "Elite"].includes(r.tier) ? r.tier : null;
          if (r.managerIsMe) r.manager = null;
          clean.push({ me: !!r.managerIsMe, name, email, dept: r.dept, jobTitle: r.jobTitle ? String(r.jobTitle).slice(0, 60) : null, rung, tier, manager: r.manager ? String(r.manager).trim() : null });
        }
        if (!clean.length) return fail(res, 400, "Nothing to import.");
        const col = k => clean.map(r => r[k]);
        // The PL team works in the Philippines (Alan, in Portland, isn't on the PL list).
        const up = await sql`insert into members (name, email, dept, job_title, rung, tier, role, work_location)
          select u.name, u.email, u.dept, u.job_title, u.rung, u.tier, 'member', 'Philippines'
          from unnest(${col("name")}::text[], ${col("email")}::text[], ${col("dept")}::text[], ${col("jobTitle")}::text[], ${col("rung")}::int[], ${col("tier")}::text[])
            as u(name, email, dept, job_title, rung, tier)
          on conflict (email) do update set name = excluded.name, dept = excluded.dept,
            job_title = coalesce(excluded.job_title, members.job_title), rung = coalesce(excluded.rung, members.rung), tier = coalesce(excluded.tier, members.tier),
            work_location = case when members.work_location is null or members.work_location ilike 'manila' then 'Philippines' else members.work_location end
          returning id, (xmax = 0) as inserted`;
        // Rows that report to the admin doing the import (e.g. Karl → Alan) link to that admin directly.
        const toMe = clean.filter(r => r.me).map(r => r.email);
        if (toMe.length) await sql`update members set manager_id = ${me.id} where email = any(${toMe}::text[]) and id <> ${me.id}`;
        const withMgr = clean.filter(r => r.manager);
        if (withMgr.length) {
          await sql`update members m set manager_id = mg.id
            from unnest(${withMgr.map(r => r.email)}::text[], ${withMgr.map(r => r.manager.toLowerCase())}::text[]) as u(email, mgr)
            join members mg on lower(mg.name) = u.mgr
            where m.email = u.email and mg.id <> m.id`;
        }
        const added = up.filter(r => r.inserted).map(r => r.id);
        if (added.length) await sql`insert into member_history (member_id, field, old_value, new_value, changed_by)
          select id, 'added', null, name, ${me.id} from members where id = any(${added}::uuid[])`;
        return send(res, 200, { ok: true, added: added.length, updated: up.length - added.length, skipped });
      }
      case "swapEvRecomp": {
        await sql`insert into settings (key, value) values ('swap_ev_recomp', ${JSON.stringify(!!b.on)}::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`;
        await sql`delete from mb_cache`.catch(() => {});
        return send(res, 200, { ok: true, on: !!b.on });
      }
      case "productionSave": {
        const cardId = Number(b.cardId) || null;
        const v = cardId ? { cardId, nameCol: String(b.nameCol || "FULL_NAME").slice(0, 60), dateCol: String(b.dateCol || "WORK_DATE").slice(0, 60), totalCol: String(b.totalCol || "TOTAL_CARDS").slice(0, 60) } : {};
        await sql`insert into settings (key, value) values ('production', ${JSON.stringify(v)}::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return send(res, 200, { ok: true });
      }
      case "metricsSave": {
        // [{ id, name, kind: dashboard|question|public, ref: number or https URL, audience: admins|leads|everyone }]
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 30).map((x, i) => {
          const kind = ["dashboard", "question", "public"].includes(x.kind) ? x.kind : "dashboard";
          const ref = kind === "public" ? String(x.ref || "").trim() : String(Number(x.ref) || "");
          return { id: String(x.id || i + 1).slice(0, 40), name: String(x.name || "Dashboard").trim().slice(0, 60), kind, ref,
            audience: ["admins", "leads", "everyone"].includes(x.audience) ? x.audience : "admins" };
        });
        for (const x of items) {
          if (x.kind === "public" && !/^https:\/\/[^\s]+\/public\/(dashboard|question)\/[\w-]+/.test(x.ref)) return fail(res, 400, `“${x.name}”: paste a Metabase public link (https://…/public/dashboard/…).`);
          if (x.kind !== "public" && !x.ref) return fail(res, 400, `“${x.name}”: enter the ${x.kind} number from its Metabase URL.`);
        }
        await sql`insert into settings (key, value) values ('metrics', ${JSON.stringify(items)}::jsonb)
          on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return send(res, 200, { ok: true });
      }
      case "inviteLinks": {
        // Copy-able personal sign-up links (for text or chat). Marks them as invited.
        const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 300);
        const base = (process.env.APP_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/+$/, "");
        const rows = await sql`select id, name, email, pin_hash from members where id = any(${ids}::uuid[]) and active and email is not null`;
        const links = rows.map(m => ({ id: m.id, name: m.name, email: m.email, signedUp: !!m.pin_hash, link: `${base}/?join=${encodeURIComponent(inviteToken(m))}` }));
        const fresh = rows.filter(m => !m.pin_hash).map(m => m.id);
        if (fresh.length) await sql`update members set invited_at = coalesce(invited_at, now()) where id = any(${fresh}::uuid[])`;
        return send(res, 200, { ok: true, links });
      }
      case "invite": {
        // Email sign-up invites. Link opens the app with their email filled in.
        const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 300);
        const base = (process.env.APP_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/+$/, "");
        const rows = await sql`select id, name, email from members where id = any(${ids}::uuid[]) and active and email is not null`;
        const sent = [], failed = [];
        for (const m of rows) {
          try { await sendInvite(m, `${base}/?join=${encodeURIComponent(inviteToken(m))}`, me.name); sent.push(m.id); }
          catch (e) { failed.push({ name: m.name, error: e.message }); if (e.status === 400) break; }
        }
        if (sent.length) await sql`update members set invited_at = now() where id = any(${sent}::uuid[])`;
        return send(res, 200, { ok: true, sent: sent.length, failed });
      }
      case "annPost": {
        const body = String(b.body || "").trim().slice(0, 4000);
        const image = typeof b.image === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(b.image) && b.image.length < 1_500_000 ? b.image : null;
        if (!body && !image) return fail(res, 400, "Write a message or attach an image.");
        await sql`delete from announcements where created_at < now() - interval '7 days'`;
        await sql`insert into announcements (author_id, body, image) values (${me.id}, ${body}, ${image})`;
        await sql`insert into notifications (member_id, kind, title, body, link)
          select id, 'announce', ${`${me.name} posted an announcement`}, ${body.slice(0, 200)}, '#announcements' from members where active and id <> ${me.id}`;
        return send(res, 200, { ok: true });
      }
      case "annDelete":
        await sql`delete from announcements where id = ${Number(b.id) || 0}`;
        return send(res, 200, { ok: true });
      case "cycleCreate": {
        const name = String(b.name || "").trim().slice(0, 60); if (!name) return fail(res, 400, "Name the review cycle.");
        for (const k of ["periodStart", "periodEnd", "due"]) if (b[k] && !dayOk(b[k])) return fail(res, 400, "Check the dates.");
        const depts = Array.isArray(b.depts) ? b.depts.filter(x => DEPTS.includes(x)) : [];
        const kind = ["Performance", "Probation", "Promotion"].includes(b.kind) ? b.kind : "Performance";
        const [cy] = await sql`insert into review_cycles (name, period_start, period_end, due, created_by, kind, review_due)
          values (${name}, ${b.periodStart || null}, ${b.periodEnd || null}, ${b.due || null}, ${me.id}, ${kind}, ${dayOk(b.reviewDue) ? b.reviewDue : null}) returning id`;
        // One review per active person in the chosen teams; the reviewer is their manager (or the admin creating the cycle).
        const ins = await sql`insert into reviews (cycle_id, member_id, reviewer_id)
          select ${cy.id}, m.id, coalesce(m.manager_id, ${me.id}) from members m
          where m.active and (${depts.length === 0} or m.dept = any(${depts}::text[])) returning member_id`;
        // Nobody is notified yet: admins/managers send each person their self review with "Send self review".
        return send(res, 200, { ok: true, created: ins.length });
      }
      case "cycleAddPeople": {
        // Add teams (or everyone) to a cycle that's already running; people already in it are skipped. Reviewer = their manager.
        const depts = Array.isArray(b.depts) ? b.depts.filter(x => DEPTS.includes(x)) : [];
        const all = !!b.everyone;
        if (!all && !depts.length) return fail(res, 400, "Pick at least one team.");
        const ins = await sql`insert into reviews (cycle_id, member_id, reviewer_id)
          select ${b.id}, m.id, coalesce(m.manager_id, ${me.id}) from members m
          where m.active and (${all} or m.dept = any(${depts}::text[]))
            and not exists (select 1 from reviews r where r.cycle_id = ${b.id} and r.member_id = m.id) returning member_id`;
        return send(res, 200, { ok: true, added: ins.length });
      }
      case "cycleDates": {
        // Change the self review due date or the Year End Review due date.
        if (b.due !== undefined) await sql`update review_cycles set due = ${dayOk(b.due) ? b.due : null} where id = ${b.id}`;
        if (b.reviewDue !== undefined) await sql`update review_cycles set review_due = ${dayOk(b.reviewDue) ? b.reviewDue : null} where id = ${b.id}`;
        return send(res, 200, { ok: true });
      }
      case "cycleStatus": {
        await sql`update review_cycles set status = ${b.status === "closed" ? "closed" : "open"} where id = ${b.id}`;
        return send(res, 200, { ok: true });
      }
      case "toSchedule": {
        if (!["Vacation", "Sick leave", "Bereavement"].includes(b.type)) return fail(res, 400, "Pick a type of time off.");
        if (!dayOk(b.start) || !dayOk(b.end) || b.end < b.start) return fail(res, 400, "Pick a first and last day.");
        const [clash] = await sql`select 1 from time_off where member_id = ${b.memberId} and status in ('pending', 'approved')
          and start_date <= ${b.end}::date and end_date >= ${b.start}::date`;
        if (clash) return fail(res, 409, "They already have time off on some of those days.");
        const [ins] = await sql`insert into time_off (member_id, type, start_date, end_date, note, status, decided_by, decided_at)
          values (${b.memberId}, ${b.type}, ${b.start}, ${b.end}, ${String(b.note || "").slice(0, 200)}, 'approved', ${me.id}, now()) returning id`;
        if (b.memberId !== me.id) await notify(b.memberId, { kind: "scheduled", title: `${me.name} scheduled ${b.type} for you: ${rangeText(b.start, b.end)}`, body: String(b.note || ""), link: "#mytime-requests", refId: ins.id });
        return send(res, 200, { ok: true });
      }
      case "toDecide": {
        if (!["approved", "denied"].includes(b.status)) return fail(res, 400, "Unknown decision.");
        const [r] = await sql`update time_off set status = ${b.status}, decided_by = ${me.id}, decided_at = now(),
          decision_note = ${String(b.note || "").slice(0, 500)} where id = ${b.id} and status = 'pending'
          returning id, member_id, type, to_char(start_date, 'YYYY-MM-DD') as s, to_char(end_date, 'YYYY-MM-DD') as e`;
        if (!r) return fail(res, 409, "That request was already decided or cancelled.");
        // Tell the team member in their portal (and by email when Resend is configured).
        await notify(r.member_id, { kind: b.status, title: `Your ${r.type} request (${rangeText(r.s, r.e)}) was ${b.status} by ${me.name}`, body: String(b.note || "").slice(0, 200), link: "#mytime-requests", refId: r.id });
        return send(res, 200, { ok: true });
      }
      case "shiftDelete":
        await sql`delete from shifts where id = ${b.id}`;
        return send(res, 200, { ok: true });

      case "memberAdd":
      case "memberUpdate": {
        const f = b.fields || {};
        const name = f.name != null ? String(f.name).trim().slice(0, 60) : undefined;
        const email = f.email != null ? normEmail(f.email) : undefined;
        const phone = f.phone != null ? normPhone(f.phone) : undefined;
        if (name !== undefined && !name) return fail(res, 400, "Name is required.");
        if (email !== undefined && !emailOk(email)) return fail(res, 400, "That email doesn’t look right.");
        if (phone && !phoneOk(phone)) return fail(res, 400, "Enter the phone with country code, like +639171234567.");
        if (f.dept !== undefined && !DEPTS.includes(f.dept)) return fail(res, 400, "Unknown department.");
        if (f.role !== undefined && !["member", "admin"].includes(f.role)) return fail(res, 400, "Unknown role.");
        if (f.rung !== undefined && f.rung !== null && !(Number.isInteger(f.rung) && f.rung >= 0 && f.rung <= 10)) return fail(res, 400, "Unknown title.");
        if (f.tier !== undefined && f.tier !== null && !["Prime", "Pro", "Elite"].includes(f.tier)) return fail(res, 400, "Unknown tier.");
        if (f.startDate !== undefined && f.startDate !== null && !dayOk(f.startDate)) return fail(res, 400, "Enter a valid start date.");
        if (f.leaveDays !== undefined && f.leaveDays !== null && !(Number.isInteger(f.leaveDays) && f.leaveDays >= 0 && f.leaveDays <= 60)) return fail(res, 400, "Leave days must be 0 to 60.");
        const pick = (k, list) => f[k] === undefined || f[k] === null || f[k] === "" || list.includes(f[k]);
        if (!pick("employmentType", ["Full-time", "Part-time", "Contractor", "Intern"])) return fail(res, 400, "Unknown employment type.");
        if (!pick("payType", ["Hourly", "Salaried"])) return fail(res, 400, "Unknown pay type.");
        if (!pick("overtime", ["Eligible", "Exempt"])) return fail(res, 400, "Unknown overtime setting.");
        if (f.personalEmail && !emailOk(normEmail(f.personalEmail))) return fail(res, 400, "That personal email doesn’t look right.");
        if (f.managerId) {
          if (f.managerId === b.id) return fail(res, 400, "Someone can’t report to themselves.");
          const chain = await sql`with recursive up as (select id, manager_id from members where id = ${f.managerId}
            union select m.id, m.manager_id from members m join up on m.id = up.manager_id) select id from up`;
          if (!chain.length) return fail(res, 400, "That manager isn’t on the roster.");
          if (chain.some(r => r.id === b.id)) return fail(res, 400, "That would make a reporting loop.");
        }
        try {
          if (b.op === "memberAdd") {
            if (!name || !email) return fail(res, 400, "Name and email are required.");
            // adding someone by hand who was deleted before: take them off the deleted list
            await sql`update settings set value = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(value) x where lower(x->>'email') <> ${email}) where key = 'deleted_people'`;
            const [nm] = await sql`insert into members (name, email, phone, dept, role, manager_id, rung, tier, start_date, job_title, work_location, personal_email)
              values (${name}, ${email}, ${phone || null}, ${f.dept || "Grading"}, ${f.role || "member"}, ${f.managerId || null}::uuid, ${f.rung ?? null}::int, ${f.tier || null},
                ${f.startDate || null}::date, ${f.jobTitle ? String(f.jobTitle).trim().slice(0, 60) : null}, ${f.workLocation ? String(f.workLocation).trim().slice(0, 60) : null}, ${f.personalEmail ? normEmail(f.personalEmail) : null}) returning id`;
            await sql`insert into member_history (member_id, field, old_value, new_value, changed_by) values (${nm.id}, 'added', null, ${name}, ${me.id})`;
            return send(res, 200, { ok: true, id: nm.id });
          } else {
            // Admins can change their own access too, as long as another active admin remains (checked below).
            const [cur] = await sql`select role, active from members where id = ${b.id}`;
            if (cur && cur.role === "admin" && (f.role === "member" || f.active === false)) {
              const [{ n }] = await sql`select count(*)::int as n from members where role = 'admin' and active and id <> ${b.id}`;
              if (!n) return fail(res, 400, "At least one admin is needed.");
            }
            if (f.role === "admin" && (f.active === false || (cur && !cur.active && f.active !== true))) return fail(res, 400, "Reactivate them before making them an admin.");
            if (f.active === false) {
              const [o] = await sql`select 1 from shifts where member_id = ${b.id} and clock_out is null`;
              if (o) return fail(res, 409, "Clock them out before deactivating.");
            }
            const has = k => f[k] !== undefined;
            const [before] = await sql`select name, email, phone, dept, role, active, manager_id as "managerId", rung, tier,
              to_char(start_date, 'YYYY-MM-DD') as "startDate", job_title as "jobTitle", leave_days as "leaveDays", employment_type as "employmentType", work_location as "workLocation", personal_email as "personalEmail", coalesce(meet_link, case when lower(email) = 'alan@arenaclub.com' then 'https://meet.google.com/ara-qmvp-frj' end) as "meetLink", anytime_off as "anytimeOff", default_codes as "repeatCodes", pay_type as "payType", overtime, salary::float8 as salary, allowance::float8 as allowance from members where id = ${b.id}`;
            if (!before) return fail(res, 404, "That person isn’t on the roster.");
            await sql`update members set
              name = coalesce(${name ?? null}, name), email = coalesce(${email ?? null}, email),
              phone = case when ${phone !== undefined} then ${phone || null} else phone end,
              dept = coalesce(${f.dept ?? null}, dept), role = coalesce(${f.role ?? null}, role),
              active = coalesce(${f.active ?? null}::boolean, active),
              manager_id = case when ${has("managerId")} then ${f.managerId || null}::uuid else manager_id end,
              rung = case when ${has("rung")} then ${f.rung ?? null}::int else rung end,
              tier = case when ${has("tier")} then ${f.tier || null} else tier end,
              start_date = case when ${has("startDate")} then ${f.startDate || null}::date else start_date end,
              job_title = case when ${has("jobTitle")} then ${f.jobTitle ? String(f.jobTitle).trim().slice(0, 60) : null} else job_title end,
              leave_days = case when ${has("leaveDays")} then ${f.leaveDays ?? null}::int else leave_days end,
              employment_type = case when ${has("employmentType")} then ${f.employmentType || null} else employment_type end,
              work_location = case when ${has("workLocation")} then ${f.workLocation ? String(f.workLocation).trim().slice(0, 60) : null} else work_location end,
              personal_email = case when ${has("personalEmail")} then ${f.personalEmail ? normEmail(f.personalEmail) : null} else personal_email end,
              pay_type = case when ${has("payType")} then ${f.payType || null} else pay_type end,
              overtime = case when ${has("overtime")} then ${f.overtime || null} else overtime end,
              org_solo = case when ${has("orgSolo")} then ${!!f.orgSolo} else org_solo end,
              salary = case when ${has("salary")} then ${f.salary === null || f.salary === "" ? null : Math.max(0, Number(f.salary) || 0)}::numeric else salary end,
              allowance = case when ${has("allowance")} then ${f.allowance === null || f.allowance === "" ? null : Math.max(0, Number(f.allowance) || 0)}::numeric else allowance end
              where id = ${b.id}`;
            // Profile history: one row per field that actually changed.
            const [after] = await sql`select name, email, phone, dept, role, active, manager_id as "managerId", rung, tier,
              to_char(start_date, 'YYYY-MM-DD') as "startDate", job_title as "jobTitle", leave_days as "leaveDays", employment_type as "employmentType", work_location as "workLocation", personal_email as "personalEmail", coalesce(meet_link, case when lower(email) = 'alan@arenaclub.com' then 'https://meet.google.com/ara-qmvp-frj' end) as "meetLink", anytime_off as "anytimeOff", default_codes as "repeatCodes", pay_type as "payType", overtime, salary::float8 as salary, allowance::float8 as allowance from members where id = ${b.id}`;
            const str = v => v == null ? null : String(v);
            for (const k of Object.keys(after)) {
              if (str(before[k]) !== str(after[k]))
                await sql`insert into member_history (member_id, field, old_value, new_value, changed_by) values (${b.id}, ${k}, ${str(before[k])}, ${str(after[k])}, ${me.id})`;
            }
          }
        } catch (e) { if (e.code === "23505") return fail(res, 409, "Someone else already uses that email."); throw e; }
        return send(res, 200, { ok: true });
      }
      case "adminAnyTime": {
        // Admin chip on the Schedule row: an admin can switch their own (or another admin's) "clock in any time" on or off.
        const [t] = await sql`select id, role from members where id = ${b.memberId}`;
        if (!t || t.role !== "admin") return fail(res, 400, "Only admins have this switch.");
        await sql`update members set anytime_off = ${!b.on} where id = ${t.id}`;
        return send(res, 200, { ok: true, on: !!b.on });
      }
      case "reviewQuestions": {
        // The questions used for new self reviews and manager reviews (Reviews › Questions). Empty = back to the built-in ones.
        const clean = (x, n) => String(x || "").replace(/\s+/g, " ").trim().slice(0, n);
        const self = (Array.isArray(b.self) ? b.self : []).map(x => [clean(x?.[0] ?? x?.q, 400), clean(x?.[1] ?? x?.hint, 300)]).filter(x => x[0]).slice(0, 12);
        const mgr = (Array.isArray(b.mgr) ? b.mgr : []).map(x => clean(x, 400)).filter(Boolean).slice(0, 12);
        const extra = clean(b.extra, 300);
        const v = b.reset ? null : { self, mgr, extra };
        if (v && (!self.length || !mgr.length)) return fail(res, 400, "Keep at least one self review question and one manager statement.");
        if (v) await sql`insert into settings (key, value) values ('review_questions', ${JSON.stringify(v)}::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`;
        else await sql`delete from settings where key = 'review_questions'`;
        return send(res, 200, { ok: true });
      }
      case "metricsTeam": {
        // Metrics: put a Metabase name that isn't an app user under a team (e.g. the Oregon Review team). Empty dept removes it.
        const name = String(b.name || "").trim().toLowerCase().slice(0, 80), dept = DEPTS.includes(b.dept) || b.dept === "Oregon" ? b.dept : null;   // Oregon = Metrics-only team
        if (!name) return fail(res, 400, "Missing name.");
        const [row] = await sql`select value from settings where key = 'metrics_teams'`;
        const v = { ...(row?.value || {}) }; if (dept) v[name] = dept; else v[name] = "";
        await sql`insert into settings (key, value) values ('metrics_teams', ${JSON.stringify(v)}::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return send(res, 200, { ok: true });
      }
      case "idleSignout": {
        const v = [0, 15, 30, 60, 240].includes(+b.minutes) ? +b.minutes : 0;
        await sql`insert into settings (key, value) values ('idle_signout', ${JSON.stringify(v)}::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return send(res, 200, { ok: true, minutes: v });
      }
      case "demoSetting": {
        // Team settings › show "Explore the demo" on the sign-in page (off by default)
        await sql`insert into settings (key, value) values ('demo_on_login', ${JSON.stringify(!!b.on)}::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return send(res, 200, { ok: true, on: !!b.on });
      }
      case "memberDelete": {
        // Permanently removes a person and their own records (timecards, time off, schedules, reviews, 1:1s, notifications).
        // People who reported to them keep working; their "reports to" is just cleared.
        if (b.id === me.id) return fail(res, 400, "You can’t delete your own account.");
        const [m] = await sql`select id, name, role from members where id = ${b.id}`;
        if (!m) return fail(res, 404, "That person is already gone.");
        if (m.role === "admin") { const [{ n }] = await sql`select count(*)::int n from members where role = 'admin' and active`; if (n <= 1) return fail(res, 400, "Keep at least one admin."); }
        if (String(b.confirmName || "").trim().toLowerCase() !== m.name.trim().toLowerCase()) return fail(res, 400, "Type their full name to confirm.");
        const [full] = await sql`select email from members where id = ${b.id}`;
        await sql`update members set manager_id = null where manager_id = ${b.id}`;
        await sql`delete from members where id = ${b.id}`;
        // Remember them so "Import the PL team" and Metrics don't bring them back. Adding them again by hand clears this.
        await sql`insert into settings (key, value) values ('deleted_people', ${JSON.stringify([{ email: full?.email || "", name: m.name, at: Date.now() }])}::jsonb)
          on conflict (key) do update set value = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(settings.value) x where x->>'email' <> ${full?.email || ""}) || excluded.value, updated_at = now()`;
        return send(res, 200, { ok: true, name: m.name });
      }
      case "resetPin":
        await sql`update members set pin_hash = null, pin_salt = null, pin_fails = 0, pin_lock_until = null where id = ${b.id}`;
        await sql`insert into member_history (member_id, field, old_value, new_value, changed_by) values (${b.id}, 'pin', null, 'reset', ${me.id})`;
        return send(res, 200, { ok: true });
      default: return fail(res, 400, "Unknown action");
    }
  } catch (e) {
    console.error(e);
    return fail(res, 500, setupMessage(e) || "Something went wrong. Try again.");
  }
}
