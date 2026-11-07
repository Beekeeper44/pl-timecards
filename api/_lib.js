import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";
// Neon: the Vercel ↔ Neon integration sets DATABASE_URL (and POSTGRES_URL); either works.
export const DB_URL = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
// Metabase, named like the other Arena tools: METABASE_HOST + METABASE_API_KEY (METABASE_SITE_URL still works).
export const MB_HOST = () => (process.env.METABASE_HOST || process.env.METABASE_SITE_URL || "").trim().replace(/\/+$/, "");

// Created on first use so a missing DATABASE_URL gives a clear error instead of crashing the function.
let _sql = null;
export const sql = (strings, ...vals) => {
  if (!DB_URL()) throw Object.assign(new Error("DATABASE_URL is not set"), { setup: true });
  _sql ??= neon(DB_URL());
  return _sql(strings, ...vals);
};

// Turns configuration problems into a message the sign-in screen can show.
export function setupMessage(e) {
  if (!DB_URL()) return "Server setup: DATABASE_URL isn’t set in Vercel. Add it, then redeploy.";
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return "Server setup: SESSION_SECRET is missing or shorter than 32 characters. Add it, then redeploy.";
  if (/ENOTFOUND|getaddrinfo|password authentication|fetch failed|connect|does not exist|invalid connection/i.test(e?.message || "")) return "Server setup: can’t connect to the Neon database. Check DATABASE_URL.";
  return null;
}
export const PAY_TZ = "Asia/Manila";

// Migrations run once per schema version instead of on every cold start. The version is a hash of migrate()'s code,
// saved in settings.schema_version, so editing the migrations below re-runs them once on the next request.
let ready = null;
export function ensureSchema() {
  ready ??= (async () => {
    try {
      const [v] = await sql`select value from settings where key = 'schema_version'`;
      if (v && v.value === SCHEMA_VERSION) return;
    } catch (e) { /* first run: no settings table yet */ }
    await migrate();
    await sql`insert into settings (key, value) values ('schema_version', ${JSON.stringify(SCHEMA_VERSION)}::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
  })().catch(e => { ready = null; throw e; });
  return ready;
}
const SCHEMA_VERSION = crypto.createHash("sha1").update(migrate.toString()).digest("hex").slice(0, 12);
async function migrate() {
    await sql`create table if not exists members (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      email text unique not null,
      phone text,
      dept text not null default 'Grading',
      role text not null default 'member',
      active boolean not null default true,
      pin_hash text, pin_salt text,
      pin_fails int not null default 0,
      pin_lock_until timestamptz,
      created_at timestamptz not null default now())`;
    await sql`create table if not exists codes (
      id bigserial primary key,
      member_id uuid not null references members(id) on delete cascade,
      channel text not null,
      code_hash text,
      expires_at timestamptz not null,
      attempts int not null default 0,
      used boolean not null default false,
      created_at timestamptz not null default now())`;
    await sql`create table if not exists shifts (
      id uuid primary key default gen_random_uuid(),
      member_id uuid not null references members(id) on delete cascade,
      day date not null,
      clock_in timestamptz not null,
      clock_out timestamptz,
      breaks jsonb not null default '[]',
      break_min int,
      note text not null default '',
      edited boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now())`;
    await sql`create index if not exists shifts_day on shifts(day)`;
    await sql`alter table members add column if not exists manager_id uuid references members(id) on delete set null`;
    await sql`alter table members add column if not exists rung int`;
    await sql`alter table members add column if not exists tier text`;
    await sql`alter table members add column if not exists start_date date`;
    await sql`create table if not exists time_off (
      id uuid primary key default gen_random_uuid(),
      member_id uuid not null references members(id) on delete cascade,
      type text not null,
      start_date date not null,
      end_date date not null,
      note text not null default '',
      status text not null default 'pending',
      decided_by uuid references members(id) on delete set null,
      decided_at timestamptz,
      decision_note text not null default '',
      created_at timestamptz not null default now())`;
    await sql`create index if not exists time_off_dates on time_off(end_date)`;
    await sql`update time_off set type = 'Sick leave' where type = 'Sick'`; // renamed leave type
    await sql`update members set dept = 'Managers' where dept = 'Lead'`; // the Lead team is now Managers
    await sql`create table if not exists notifications (
      id bigserial primary key,
      member_id uuid not null references members(id) on delete cascade,
      kind text not null, title text not null, body text not null default '', link text,
      ref_id text, read_at timestamptz, created_at timestamptz not null default now())`;
    await sql`create index if not exists notifications_member on notifications(member_id, created_at desc)`;
    // 1:1s, review cycles, reviews and person updates
    await sql`create table if not exists meetings (
      id uuid primary key default gen_random_uuid(),
      manager_id uuid not null references members(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      starts_at timestamptz not null, duration_min int not null default 30,
      repeat text not null default 'none', status text not null default 'scheduled',
      points jsonb not null default '[]', notes text not null default '', private_notes text not null default '',
      actions jsonb not null default '[]', created_by uuid references members(id) on delete set null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
    await sql`create table if not exists review_cycles (
      id uuid primary key default gen_random_uuid(), name text not null,
      period_start date, period_end date, due date, status text not null default 'open',
      created_by uuid references members(id) on delete set null, created_at timestamptz not null default now())`;
    await sql`alter table review_cycles add column if not exists kind text not null default 'Performance'`;
    await sql`create table if not exists reviews (
      id uuid primary key default gen_random_uuid(),
      cycle_id uuid not null references review_cycles(id) on delete cascade,
      member_id uuid not null references members(id) on delete cascade,
      reviewer_id uuid references members(id) on delete set null,
      rating int, strengths text not null default '', growth text not null default '', goals text not null default '',
      self_text text not null default '', self_rating int, status text not null default 'not_started',
      updated_at timestamptz not null default now(), shared_at timestamptz, unique (cycle_id, member_id))`;
    await sql`create table if not exists person_updates (
      id bigserial primary key, member_id uuid not null references members(id) on delete cascade,
      author_id uuid references members(id) on delete set null, kind text not null default 'note',
      body text not null, shared boolean not null default false, created_at timestamptz not null default now())`;
    await sql`alter table members add column if not exists job_title text`;
    await sql`alter table members add column if not exists employment_type text`;
    await sql`alter table members add column if not exists work_location text`;
    await sql`alter table members add column if not exists personal_email text`;
    await sql`alter table members add column if not exists pay_type text`;
    await sql`alter table members add column if not exists overtime text`;
    await sql`create table if not exists member_history (
      id bigserial primary key,
      member_id uuid not null references members(id) on delete cascade,
      field text not null, old_value text, new_value text,
      changed_by uuid references members(id) on delete set null,
      changed_at timestamptz not null default now())`;
    await sql`create table if not exists settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now())`;
    // One-time: clear every phone number on file (Oct 2026). People add their own number when they sign up.
    // The settings flag keeps this from running again on later schema changes.
    const [clearPhones] = await sql`insert into settings (key, value) values ('phones_cleared_2026_10', 'true'::jsonb) on conflict (key) do nothing returning key`;
    if (clearPhones) await sql`update members set phone = null where phone is not null`;
    await sql`alter table shifts add column if not exists late boolean not null default false`;
    await sql`alter table shifts add column if not exists left_early boolean not null default false`;
    await sql`alter table shifts add column if not exists count_from timestamptz`;   // early clock-in: hours count from the start time
    await sql`alter table shifts add column if not exists late_by int`;              // minutes late (after the grace period)
    await sql`alter table shifts add column if not exists early_by int`;             // minutes clocked out before the end
    await sql`alter table shifts add column if not exists device_in text`;           // computer / phone used to clock in
    await sql`alter table shifts add column if not exists device_out text`;          // and to clock out
    // One-time: the new attendance rules (2-minute grace, 5 minutes allowed before the end) on an already-saved time clock.
    const [att] = await sql`insert into settings (key, value) values ('attendance_rules_v1', 'true'::jsonb) on conflict (key) do nothing returning key`;
    if (att) await sql`update settings set value = value || '{"lateMin": 2, "earlyOutMin": 5}'::jsonb where key = 'shift'`;
    await sql`alter table shifts add column if not exists kind text`; // e.g. 5H / 6H when clocked in on a habit window
    // Timecard approval: pending → approved / rejected by an admin or the person's manager.
    await sql`alter table shifts add column if not exists approval text not null default 'pending'`;
    await sql`alter table shifts add column if not exists approved_by uuid references members(id) on delete set null`;
    await sql`alter table shifts add column if not exists approved_at timestamptz`;
    await sql`alter table shifts add column if not exists approval_note text not null default ''`;
    await sql`alter table members add column if not exists photo text`;
    await sql`alter table members add column if not exists org_solo boolean not null default false`;
    await sql`alter table members add column if not exists invited_at timestamptz`;   // last sign-up invite sent   // org chart: show on its own under the manager              // small JPEG data URL (≈256px)
    await sql`alter table members add column if not exists photo_at timestamptz`;    // cache-busting version
    await sql`alter table members add column if not exists salary numeric`;     // monthly basic, PHP (admins only)
    await sql`alter table members add column if not exists allowance numeric`;  // monthly allowance, PHP (admins only)
    await sql`create table if not exists announcements (
      id bigserial primary key, author_id uuid references members(id) on delete set null,
      body text not null default '', image text, created_at timestamptz not null default now())`;
    await sql`alter table members add column if not exists leave_days int`;
    await sql`create table if not exists schedules (
      member_id uuid not null references members(id) on delete cascade,
      day date not null,
      codes text[] not null default '{}',
      updated_at timestamptz not null default now(),
      primary key (member_id, day))`;
    await sql`create unique index if not exists shifts_one_open on shifts(member_id) where clock_out is null`;
    // change counter: bumped on every write so open browsers can refresh within a few seconds
    await sql`create sequence if not exists app_rev`;
    // Metabase results are cached in the database for an hour so every server instance shares one copy.
    await sql`create table if not exists mb_cache (card_id int primary key, fetched_at timestamptz not null default now(), rows jsonb not null)`;
    await sql`alter table meetings add column if not exists link text`;   // Google Meet (or Zoom/Teams) link for the 1:1
    await sql`alter table members add column if not exists meet_link text`;
    await sql`alter table members add column if not exists anytime_off boolean not null default false`;
    await sql`alter table members add column if not exists default_codes text[] not null default '{}'`;   // habits that repeat every workday
    await sql`alter table schedules add column if not exists auto boolean not null default false`;      // row filled from default_codes   // admin switched their "any time" off   // this person's usual 1:1 meeting link (used when they book a 1:1)
    // One-time: Alan's usual Google Meet room, also on his upcoming 1:1s that don't have a link yet.
    const [ml] = await sql`insert into settings (key, value) values ('meet_link_alan_v1', 'true'::jsonb) on conflict (key) do nothing returning key`;
    if (ml) {
      await sql`update members set meet_link = 'https://meet.google.com/ara-qmvp-frj' where lower(email) = 'alan@arenaclub.com' and meet_link is null`;
      await sql`update meetings set link = 'https://meet.google.com/ara-qmvp-frj' where link is null and status = 'scheduled' and manager_id in (select id from members where lower(email) = 'alan@arenaclub.com')`;
    }
    // One-time: undo the earlier mistaken switch of Cards by task to 46762 (that question is the Overtime board).
    const [q46] = await sql`insert into settings (key, value) values ('cards_q46531_back_v1', 'true'::jsonb) on conflict (key) do nothing returning key`;
    if (q46) await sql`update settings set value = jsonb_set(value, '{cardId}', '46531'::jsonb) where key = 'production' and (value->>'cardId') = '46762'`;
    // One-time: remove reviews where the person would review themselves (nobody above them), if nothing was written yet.
    const [selfRv] = await sql`insert into settings (key, value) values ('no_self_reviewer_v1', 'true'::jsonb) on conflict (key) do nothing returning key`;
    if (selfRv) await sql`delete from reviews where member_id = reviewer_id and coalesce(jsonb_array_length(self_answers), 0) = 0
      and coalesce(jsonb_array_length(mgr_answers), 0) = 0 and status <> 'shared'`.catch(() => {});
    // One-time: Princess Cabalar (Metabase: Princess / Cess Cordova) moved from Data to Grading, reporting to Ehm Crucillo.
    const [pc] = await sql`insert into settings (key, value) values ('princess_grading_v1', 'true'::jsonb) on conflict (key) do nothing returning key`;
    if (pc) await sql`update members set dept = 'Grading', job_title = 'Grading Annotator 1',
      manager_id = coalesce((select id from members where name = 'Ehm Crucillo' limit 1), manager_id) where lower(email) = 'princess.c@precisionlabeling.com'`;
    // One-time: everyone except Alan works in the Philippines.
    const [loc] = await sql`insert into settings (key, value) values ('location_ph_v1', 'true'::jsonb) on conflict (key) do nothing returning key`;
    if (loc) await sql`update members set work_location = 'Philippines' where lower(email) <> 'alan@arenaclub.com' and (work_location is null or work_location ilike 'manila' or work_location = '')`;
    // Reviews: columns added over time (after the reviews and settings tables exist, so a brand-new database works too).
    await sql`alter table reviews add column if not exists self_answers jsonb`;        // [{ q, a }] self review answers
    await sql`alter table reviews add column if not exists mgr_answers jsonb`;         // [{ q, rating }] manager's 1–5 votes
    await sql`alter table reviews add column if not exists self_sent_at timestamptz`;  // when the self review was sent (unlocked)
    await sql`alter table reviews add column if not exists extra_info text`;           // "What additional information (if any)…"
    await sql`alter table reviews add column if not exists self_submitted_at timestamptz`;   // set on submit; cleared by Unlock
    await sql`alter table review_cycles add column if not exists review_due date`;     // when managers send the Year End Review
    await sql`update review_cycles set review_due = make_date(extract(year from period_end)::int + 1, 1, 21) where review_due is null and period_end is not null`;
    // One-time: self reviews written before these columns existed count as sent and submitted.
    const [bf] = await sql`insert into settings (key, value) values ('self_submitted_backfill_v1', 'true'::jsonb) on conflict (key) do nothing returning key`;
    if (bf) await sql`update reviews set self_submitted_at = coalesce(self_submitted_at, updated_at), self_sent_at = coalesce(self_sent_at, updated_at) where coalesce(self_text, '') <> ''`;
}

// ---------- http ----------
export async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
export const send = (res, status, data) => res.status(status).json(data);
export const fail = (res, status, error) => res.status(status).json({ error });

// ---------- signed cookies ----------
const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return s;
};
const b64u = b => Buffer.from(b).toString("base64url");
// Personal sign-up link: proves the person by the link itself (sent to their work email or handed over by an admin), good for 14 days
// and only until they've created a password. Admin "Reset password" makes a fresh one work again.
export const inviteToken = m => sign({ inv: m.id, em: String(m.email || "").toLowerCase(), exp: Date.now() + 14 * 86400e3 });
// Habits set to "Repeat every workday": fill the next two weeks of workdays that have no schedule yet (a day changed by hand is never overwritten).
let lastFill = 0;
export async function fillRepeatingSchedules(force) {
  if (!force && Date.now() - lastFill < 5 * 60000) return; lastFill = Date.now();
  const sh = await getShift(), days = (sh.days && sh.days.length ? sh.days : [1, 2, 3, 4, 5]).map(Number);
  await sql`insert into schedules (member_id, day, codes, auto)
    select m.id, d::date, m.default_codes, true from members m,
      generate_series((now() at time zone ${PAY_TZ})::date, (now() at time zone ${PAY_TZ})::date + 13, interval '1 day') d
    where m.active and cardinality(m.default_codes) > 0 and extract(isodow from d)::int = any(${days}::int[])
    on conflict (member_id, day) do nothing`;
}
export function sign(payload) {
  const p = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET()).update(p).digest("base64url");
  return `${p}.${sig}`;
}
export function unsign(token) {
  if (!token || !token.includes(".")) return null;
  const [p, sig] = token.split(".");
  const want = crypto.createHmac("sha256", SECRET()).update(p).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const v = JSON.parse(Buffer.from(p, "base64url").toString()); return v.exp > Date.now() ? v : null; } catch { return null; }
}
export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setCookie(res, name, value, maxAgeSec) {
  const prev = res.getHeader("Set-Cookie") || [];
  const c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
  res.setHeader("Set-Cookie", [...[].concat(prev), c]);
}
export const clearCookie = (res, name) => setCookie(res, name, "", 0);

// Sign-ins last 14 days and renew themselves while the app is in use, so nobody is signed out mid-shift.
export const SESSION_HOURS = 14 * 24, TRUST_DAYS = 30;
export function renewSession(req, res, m) {
  const s = unsign(cookies(req).pltc_s);
  if (s && m && s.exp - Date.now() < (SESSION_HOURS - 24) * 3600e3)   // older than a day: push it out again
    setCookie(res, "pltc_s", sign({ uid: m.id, exp: Date.now() + SESSION_HOURS * 3600e3 }), SESSION_HOURS * 3600);
}
export async function currentUser(req) {
  const s = unsign(cookies(req).pltc_s);
  if (!s) return null;
  const [m] = await sql`select id, name, email, dept, role, active from members where id = ${s.uid}`;
  return m && m.active ? m : null;
}

// ---------- pins + codes ----------
export const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString("base64");
export const newSalt = () => crypto.randomBytes(16).toString("base64");
export const pinMatches = (pin, m) => {
  if (!m.pin_hash) return false;
  const a = Buffer.from(hashPin(pin, m.pin_salt)), b = Buffer.from(m.pin_hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
export const sha = s => crypto.createHash("sha256").update(s).digest("hex");
export const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

export const maskPhone = p => p ? "XXXXXX" + p.replace(/\D/g, "").slice(-4) : null;
export const maskEmail = e => { const [u, d] = e.split("@"); return `${u[0]}${"•".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}`; };
export const normEmail = e => String(e || "").trim().toLowerCase();
export const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const phoneOk = p => /^\+[1-9]\d{7,14}$/.test(p);
// Accepts "+63 917 123 4567", "0917-123-4567" or "639171234567" and returns +639171234567 (Philippine local numbers get +63).
export const normPhone = p => {
  let x = String(p || "").trim().replace(/[\s().-]/g, "");
  if (/^09\d{9}$/.test(x)) x = "+63" + x.slice(1);
  else if (/^639\d{9}$/.test(x)) x = "+" + x;
  return x;
};
export const DEPTS = ["Managers", "Analysts", "Review", "Data", "Items", "Recomp", "Community", "Grading", "CS"];

// ---------- senders ----------
const twilioAuth = () => "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
export async function twilioStart(to, channel) {
  const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/Verifications`, {
    method: "POST", headers: { Authorization: twilioAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, Channel: channel })
  });
  if (!r.ok) throw new Error("twilio_send " + r.status + " " + (await r.text()).slice(0, 200));
}
export async function twilioCheck(to, code) {
  const r = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SID}/VerificationCheck`, {
    method: "POST", headers: { Authorization: twilioAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, Code: code })
  });
  if (r.status === 404) return false; // expired or already used
  if (!r.ok) throw new Error("twilio_check " + r.status);
  return (await r.json()).status === "approved";
}
export async function sendEmailCode(to, name, code) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM, to, subject: `${code} is your PL Time Cards code`,
      text: `Hi ${name},\n\nYour PL Time Cards verification code is ${code}. It expires in 10 minutes.\n\nIf you didn’t try to sign in, tell your lead.`
    })
  });
  if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()).slice(0, 200));
}
export const devCodes = () => process.env.DEV_SHOW_CODES === "1" && process.env.VERCEL_ENV !== "production";

// ---------- normal shift (stored in Manila time; Manila has no daylight saving, so UTC+8 always) ----------
// Schedule codes a team member picks for the day. A code with a time opens an extra clock-in window that day
// (e.g. 5H = 5 AM Habit lets them start at 5 AM Manila even when the normal shift starts later).
export const DEFAULT_HABITS = {
  "5H": { label: "5 AM Habit", time: "12:50", end: "13:55", afterMin: 60 },          // Pacific (see DEFAULT_SHIFT.anchor)
  "6H": { label: "6 PM Habit", time: null, end: null, afterMin: 60 },                 // set in Time Clock Setup
  "CS": { label: "Customer Service", time: null, afterMin: 60, anytime: true, enabled: true },   // any time that day
  "OS": { label: "OS", time: null, afterMin: 60, enabled: true },
  "NS": { label: "Night Shift", time: null, end: null, afterMin: 60, enabled: true }   // CS / OS / NS can be switched off in Time Clock Setup
};
// flexDepts: teams that can clock in any time (CS / Customer Service by default).
// Defaults until an admin saves Time Clock Setup: times typed in Pacific (normal shift 1:50 PM – 10:10 PM PT).
export const DEFAULT_SHIFT = { enabled: true, anchor: "America/Los_Angeles", start: "13:50", end: "22:10", days: [1, 2, 3, 4, 5], earlyMin: 15, lateMin: 2, earlyOutMin: 5, block: true, habits: DEFAULT_HABITS, flexDepts: ["CS"],
  desktopOnly: true, mobileDepts: ["Admins"] };   // clock in/out from a laptop or desktop only; these teams may also use phones
// Phone or tablet? Browser hints + user agent, plus the page's own touchscreen check for iPads that pose as Macs.
export const isPhoneReq = (req, b = {}) => deviceOf(req, b) !== "Computer";
// What was used to clock in/out: Computer, iPhone, iPad, Android phone, Android tablet, or Phone/Tablet for anything else.
export function deviceOf(req, b = {}) {
  const ua = req.headers["user-agent"] || "", hint = req.headers["sec-ch-ua-mobile"] === "?1";
  if (/iPad/i.test(ua) || b.touchMac === true) return "iPad";
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) || hint ? "Android phone" : "Android tablet";
  if (/Kindle|Silk|Tablet/i.test(ua)) return "Tablet";
  if (hint || /Mobile|Windows Phone|webOS|BlackBerry/i.test(ua)) return "Phone";
  return "Computer";
}
// lateMin: grace after the start time before it counts as Late (2). earlyOutMin: how many minutes before the end someone may clock out (5).
const MNL = 8 * 3600e3;
const hmToMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
export async function getShift() {
  const [r] = await sql`select value from settings where key = 'shift'`;
  const v = r?.value || {};
  const habits = { ...DEFAULT_HABITS, ...(v.habits || {}) };
  if (habits.CS && /^Customer Service · any time$/i.test(habits.CS.label || "")) habits.CS = { ...habits.CS, label: "Customer Service" };
  return { ...DEFAULT_SHIFT, ...v, habits };
}
// Shift windows (UTC ms) for Manila days from `from` to `to` days around `aroundMs`. days: 1 = Monday … 7 = Sunday.
// Times are stored in the shift's anchor zone (Pacific or Manila). Windows are worked out per day in that zone,
// so a Pacific-anchored shift keeps its Pacific clock times through daylight saving (Manila times move instead).
const tzOff = (zone, ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; };
const zonedMs = (y, mo, d, min, zone) => { const g = Date.UTC(y, mo, d, 0, min); let t = g - tzOff(zone, g); t = g - tzOff(zone, t); return t; };
const dateIn = (ms, zone) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return [+p.year, +p.month - 1, +p.day]; };
const wdIn = (ms, zone) => ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(new Date(ms))];
const anchorOf = shift => shift.anchor === "America/Los_Angeles" ? "America/Los_Angeles" : "Asia/Manila";
const winFor = (y, mo, d, startHM, endHM, zone, fallbackMin) => {
  const s = zonedMs(y, mo, d, hmToMin(startHM), zone);
  let e = endHM ? zonedMs(y, mo, d, hmToMin(endHM), zone) : s + (fallbackMin ?? 60) * 60000; if (e <= s) e = endHM ? zonedMs(y, mo, d + 1, hmToMin(endHM), zone) : e + 86400000;
  return { start: s, end: e };
};
export function shiftWindows(shift, aroundMs, from = -1, to = 1) {
  const Z = anchorOf(shift); const [y, mo, d] = dateIn(aroundMs, Z); const out = [];
  for (let off = from - 1; off <= to + 1; off++) {
    const w = winFor(y, mo, d + off, shift.start, shift.end, Z);
    if (shift.days.includes(wdIn(w.start + 1, Z))) out.push(w);
  }
  return out;
}
const opensAt = (shift, w) => w.start - shift.earlyMin * 60000;
// Extra windows from today's schedule codes (5H / 6H / NS), on the Manila payroll day of `t`.
export function habitWindows(shift, codes, t) {
  const Z = anchorOf(shift); const [y, mo, d] = dateIn(t, Z); const mDay = dateIn(t, "Asia/Manila").join("-");
  const out = [];
  (codes || []).map(c => ({ code: c, h: shift.habits?.[c] })).filter(x => x.h && x.h.time).forEach(x => {
    for (let off = -1; off <= 1; off++) { const w = winFor(y, mo, d + off, x.h.time, x.h.end, Z, x.h.afterMin); if (dateIn(w.start, "Asia/Manila").join("-") === mDay) out.push({ code: x.code, ...w }); }
  });
  return out;
}
export function clockInCheck(shift, t, codes = []) {
  if (!shift.enabled) return { ok: true, late: false };
  if ((codes || []).includes("CS") && shift.habits?.CS?.enabled !== false) return { ok: true, late: false, anytime: true }; // CS code: any time that day
  const w = shiftWindows(shift, t).find(w => t >= opensAt(shift, w) && t <= w.end);
  // Clocking in early is allowed (window opens earlyMin before) but hours count from the start time (countFrom).
  const lateBy = st => Math.max(0, Math.ceil((t - st) / 60000));
  if (w) return { ok: true, late: t > w.start + shift.lateMin * 60000, lateBy: t > w.start + shift.lateMin * 60000 ? lateBy(w.start) : 0, start: w.start, countFrom: t < w.start ? w.start : null };
  const hw = [...habitWindows(shift, codes, t), ...habitWindows(shift, codes, t - 86400000)].find(w => t >= opensAt(shift, w) && t <= w.end);
  if (hw) return { ok: true, late: t > hw.start + shift.lateMin * 60000, lateBy: t > hw.start + shift.lateMin * 60000 ? lateBy(hw.start) : 0, habit: hw.code, start: hw.start, countFrom: t < hw.start ? hw.start : null };
  const next = [...shiftWindows(shift, t, 0, 8), ...habitWindows(shift, codes, t)].map(w => opensAt(shift, w)).filter(x => x > t).sort((a, b) => a - b)[0];
  const when = next ? new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(next)) : null;
  const whenPT = next && anchorOf(shift) === "America/Los_Angeles" ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(next)) : null;
  return { ok: !shift.block, late: false, outside: true, message: when ? `Clock in opens ${when} Manila time${whenPT ? ` (${whenPT} Pacific)` : ""}.` : "No shift is scheduled. Ask your lead." };
}
// Minutes someone clocked out before the end time, if more than earlyOutMin (5) early; 0 otherwise.
export function earlyOutBy(shift, inMs, outMs, kind = null) {
  if (!shift.enabled) return 0;
  const allow = (shift.earlyOutMin ?? 5) * 60000;
  let end = null;
  if (kind) { // 5H / 6H / NS sessions: compare with that code's clock-out time
    const hw = [...habitWindows(shift, [kind], inMs), ...habitWindows(shift, [kind], inMs - 86400000)].find(w => inMs >= opensAt(shift, w) && inMs <= w.end);
    if (hw && shift.habits?.[kind]?.end) end = hw.end;
  } else {
    const w = shiftWindows(shift, inMs).find(w => inMs >= opensAt(shift, w) && inMs <= w.end);
    if (w) end = w.end;
  }
  return end && outMs < end - allow ? Math.ceil((end - outMs) / 60000) : 0;
}
export const leftEarly = (shift, inMs, outMs, kind = null) => earlyOutBy(shift, inMs, outMs, kind) > 0;

// ---------- notifications (in the app; also emailed when Resend is set up) ----------
const fmtD = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const rangeText = (a, z) => a === z ? fmtD(a) : `${fmtD(a)} – ${fmtD(z)}`;
export async function notify(memberId, { kind, title, body = "", link = null, refId = null, footer = "Open PL Time Cards to see your requests." }) {
  await sql`insert into notifications (member_id, kind, title, body, link, ref_id) values (${memberId}, ${kind}, ${title}, ${body}, ${link}, ${refId})`;
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return;
  try {
    const [m] = await sql`select email, name from members where id = ${memberId}`;
    if (!m?.email) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: m.email, subject: title, text: `Hi ${m.name.split(" ")[0]},\n\n${title}${body ? "\n\n" + body : ""}\n\n${footer}` })
    });
  } catch (e) { console.error("notify email", e); }
}

// ---------- live updates ----------
// Every write bumps a counter; browsers poll it cheaply and refresh when it changes.
export const bumpRev = () => sql`select nextval('app_rev')`.catch(() => {});
export const getRev = async () => { try { const [r] = await sql`select (case when is_called then last_value else 0 end)::text as v from app_rev`; return r.v; } catch { return "0"; } };

// ---------- Metabase (signed / static embedding) ----------
// Set METABASE_HOST and METABASE_SECRET_KEY (Metabase › Admin › Embedding › Static embedding) to show dashboards on Metrics.
// The PL daily cards question (arena-club.metabaseapp.com/question/46531) is used unless an admin picks another.
export const DEFAULT_CARDS_QUESTION = 46531;
// Overtime cards by shift hour (question/46762: same columns plus SHIFT_HOUR, e.g. "10 PM – 11 PM"), admins only.
export const DEFAULT_OVERTIME_QUESTION = 46762;
export const metabaseReady = () => !!(MB_HOST() && process.env.METABASE_SECRET_KEY);
export function metabaseEmbedUrl(kind, id, params = {}) {
  const site = (MB_HOST() || "").replace(/\/+$/, ""), key = process.env.METABASE_SECRET_KEY;
  if (!site || !key || !["dashboard", "question"].includes(kind) || !Number.isInteger(Number(id))) return null;
  const enc = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ resource: { [kind]: Number(id) }, params, exp: Math.round(Date.now() / 1000) + 60 * 60 });
  const sig = crypto.createHmac("sha256", key).update(`${head}.${body}`).digest("base64url");
  return `${site}/embed/${kind}/${head}.${body}.${sig}`;
}

// ---------- Metabase question results (for the built-in "Cards today" table) ----------
// Needs METABASE_API_KEY (Metabase › Admin › Settings › Authentication › API keys) and the saved question's number.
const mbCache = new Map(); // cardId -> { at, rows, cols }
export const MB_TTL_MS = 60 * 60 * 1000;   // refresh from Metabase every hour (admins can force a refresh)
// every column that appears in any row (a summary row like TEAM TOTAL can leave some out)
const allCols = rows => [...new Set(rows.slice(0, 500).flatMap(r => Object.keys(r || {})))];
export async function metabaseCardRows(cardId, force = false) {
  const site = (MB_HOST() || "").replace(/\/+$/, ""), key = process.env.METABASE_API_KEY;
  if (!site || !key) throw Object.assign(new Error("Add METABASE_HOST and METABASE_API_KEY in Vercel to load card counts."), { status: 400 });
  if (!force) {
    const hit = mbCache.get(cardId); if (hit && Date.now() - hit.at < MB_TTL_MS) return hit;
    try { const [row] = await sql`select rows, round(extract(epoch from fetched_at) * 1000)::float8 as at from mb_cache where card_id = ${Number(cardId)}`;
      if (row && Date.now() - row.at < MB_TTL_MS) { const out = { at: row.at, rows: row.rows, cols: allCols(row.rows) }; mbCache.set(cardId, out); return out; } } catch (e) { /* table not ready yet */ }
  }
  // format_rows=false: raw numbers and ISO dates instead of "1,234" / "October 30, 2026".
  const r = await fetch(`${site}/api/card/${Number(cardId)}/query/json`, { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/x-www-form-urlencoded" }, body: "format_rows=false" });
  if (!r.ok) throw Object.assign(new Error(`Metabase answered ${r.status} for question ${cardId}. Check the number and that the API key’s group can view it.`), { status: 502 });
  const rows = await r.json();
  const out = { at: Date.now(), rows: Array.isArray(rows) ? rows : [], cols: allCols(Array.isArray(rows) ? rows : []) };
  mbCache.set(cardId, out);
  try { await sql`insert into mb_cache (card_id, rows, fetched_at) values (${Number(cardId)}, ${JSON.stringify(out.rows)}::jsonb, now())
    on conflict (card_id) do update set rows = excluded.rows, fetched_at = now()`; } catch (e) { /* too big or table missing: memory cache still works */ }
  return out;
}
// Match a name from Metabase (e.g. "Benedict Bueno", "Carmela Alvaro") to a roster member ("Ben Bueno", "Ma. Carmela A. Alvaro").
// Metabase names that are a different spelling of someone on the team (same person, numbers combined under them).
export const NAME_ALIASES = { "patrick emerson": "Pat Castillo", "pat emerson": "Pat Castillo", "princess cordova": "Princess Cabalar", "cess cordova": "Princess Cabalar" };
export function matchMember(name, members) {
  const alias = NAME_ALIASES[String(name || "").trim().toLowerCase()];
  if (alias) { const hit = members.find(m => String(m.name || "").trim().toLowerCase() === alias.toLowerCase()); if (hit) return hit; name = alias; }
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const all = norm(name).replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  const a = all.filter(t => t.length > 1), inits = all.filter(t => t.length === 1);   // "Ian f" → words ["ian"], initials ["f"]
  if (!a.length) return null;
  // Metabase sometimes shows the email name ("Ian f" = ianf@…): letters of the name = letters before the @
  const flat = all.join("");
  const byEmail = members.filter(m => m.email && norm(m.email).split("@")[0].replace(/[^a-z]/g, "") === flat);
  if (byEmail.length === 1) return byEmail[0];
  let best = null, bestScore = 0, tie = false;
  for (const m of members) {
    const b = norm(m.name).replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(t => t.length > 1); if (!b.length) continue;
    // every initial must be the first letter of one of their other names ("Ian f" → a name starting with F)
    if (inits.length && !inits.every(ch => b.slice(1).some(t => t[0] === ch))) continue;
    let score = 0;
    if (a.join(" ") === b.join(" ")) score = 100;
    else if (a.every(t => b.includes(t))) score = 80;                                   // "Adrian Carlo" ⊂ "Adrian Carlo Sanchez Pangga"
    else {
      const lastA = a[a.length - 1], firstA = a[0];
      const lastOk = b.includes(lastA) || (a.length > 2 && b.includes(a.slice(-2).join(" ")));
      const firstOk = b.some(t => t.startsWith(firstA.slice(0, 3)) || firstA.startsWith(t.slice(0, 3)));
      if (lastOk && firstOk) score = 60;                                               // "Benedict Bueno" ~ "Ben Bueno"
      else if (lastOk && b.some(t => t.slice(0, 2) === firstA.slice(0, 2))) score = 50;  // "Peter Magat" ~ "Peds Magat" (only if unique)
    }
    if (score > bestScore) { bestScore = score; best = m; tie = false; } else if (score && score === bestScore) tie = true;
  }
  if (bestScore === 100) return best;
  return !tie && bestScore >= 50 ? best : null;   // two equally good matches (e.g. "Ian" with two Ians) → don't guess
}

// ---------- sign-up invites ----------
export async function sendInvite(m, link, fromName) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) throw Object.assign(new Error("Email isn’t set up yet: add RESEND_API_KEY and RESEND_FROM in Vercel."), { status: 400 });
  const first = (m.name || "").split(" ")[0];
  const text = `Hi ${first},\n\n${fromName} invited you to PL Time Cards, where you clock in and out, request time off and see your hours.\n\nSign up in a minute:\n1. Open ${link}\n   (This link is just for you, ${m.email}. It works for 14 days.)\n2. Create a password (you'll use it with your email to sign in from now on) and add your mobile number.\n\nSee you there,\nPrecision Labeling`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">
    <p>Hi ${first},</p><p><b>${fromName}</b> invited you to <b>PL Time Cards</b>, where you clock in and out, request time off and see your hours.</p>
    <p><a href="${link}" style="display:inline-block;background:#1f9d55;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Sign up</a></p>
    <ol style="padding-left:18px"><li>Tap <b>Sign up</b>. This link is just for you (${m.email}).</li><li>Create a password (you’ll use it with your email to sign in from now on) and add your mobile number.</li></ol>
    <p style="color:#666;font-size:13px">If the button doesn’t work, open ${link}</p></div>`;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: m.email, subject: `${fromName} invited you to PL Time Cards`, text, html }) });
  if (!r.ok) throw new Error(`Email to ${m.email} failed (${r.status})`);
}
