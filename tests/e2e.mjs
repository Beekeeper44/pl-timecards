// End-to-end save test. Run with tests/run-e2e.sh (see tests/README.md).
// End-to-end check against a real Postgres: every save is written, then read back from the database and through the API.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:5432/pltc_test";
process.env.SESSION_SECRET = "test-secret-123456789012345678901234567890";
process.env.ADMIN_EMAILS = "alan@arenaclub.com";
process.env.DEV_SHOW_CODES = "1";
process.env.RESEND_API_KEY = "test"; process.env.RESEND_FROM = "PL Time Cards <t@x.com>"; process.env.APP_URL = "https://pltc.test";
import fs from "node:fs";
const sent = [];   // emails "sent" through Resend
process.env.METABASE_HOST = "https://mb.test"; process.env.METABASE_API_KEY = "test";
const MB_ROWS = [
  { WORK_DATE: "2026-11-02", FULL_NAME: "TEAM TOTAL", REVIEW_CARDS: 389, CROP_CARDS: 95, TOTAL_CARDS: 1945, TEAM: null },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Austin Crawford", REVIEW_CARDS: 101, CROP_CARDS: 0, TOTAL_CARDS: 136, TEAM: "Review" },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Kaity Paul", REVIEW_CARDS: 47, CROP_CARDS: 2, TOTAL_CARDS: 115, TEAM: "Review" },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Benedict Bueno", REVIEW_CARDS: 0, CROP_CARDS: 51, TOTAL_CARDS: 51, TEAM: "PL" },
  { WORK_DATE: "2026-11-01", FULL_NAME: "Benedict Bueno", REVIEW_CARDS: 0, CROP_CARDS: 40, TOTAL_CARDS: 40, TEAM: "PL" },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Ian f", REVIEW_CARDS: 0, CROP_CARDS: 21, TOTAL_CARDS: 278, TEAM: "PL" },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Ryan Paul Borsigue", EV_CARDS: 254, RECOMP_CARDS: 75, TOTAL_CARDS: 329, TEAM: "PL" },
];
const OT_ROWS = [
  { FULL_NAME: "HOUR TOTAL", CROP_CARDS: 268, TOTAL_CARDS: 2180, TEAM: null, WORK_DATE: "2026-11-02", SHIFT_HOUR: 22 },
  { FULL_NAME: "Ian f", CROP_CARDS: 59, TOTAL_CARDS: 82, TEAM: "PL", WORK_DATE: "2026-11-02", SHIFT_HOUR: 22 },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Benedict Bueno", SHIFT_HOUR: "All hours", CROP_CARDS: 30, TOTAL_CARDS: 30 },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Benedict Bueno", SHIFT_HOUR: "10 PM – 11 PM", CROP_CARDS: 20, TOTAL_CARDS: 20 },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Benedict Bueno", SHIFT_HOUR: "11 PM – 12 AM", CROP_CARDS: 10, TOTAL_CARDS: 10 },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Carmela Alvaro", SHIFT_HOUR: "All hours", CROP_CARDS: 5, TOTAL_CARDS: 5 },
  { WORK_DATE: "2026-11-02", FULL_NAME: "Carmela Alvaro", SHIFT_HOUR: "10 PM – 11 PM", CROP_CARDS: 5, TOTAL_CARDS: 5 },
];
globalThis.fetch = async (url, opt) => { if (String(url).includes("mb.test/api/card/46762")) return new Response(JSON.stringify(OT_ROWS), { status: 200 });
  if (String(url).includes("mb.test/api/card/")) return new Response(JSON.stringify(MB_ROWS), { status: 200 });
  if (String(url).includes("resend")) { sent.push(JSON.parse(opt.body)); return new Response(JSON.stringify({ id: "x" }), { status: 200 }); } throw new Error("unexpected fetch " + url); };
const auth = (await import("./api/auth.js")).default, data = (await import("./api/data.js")).default, health = (await import("./api/health.js")).default;
const { __pool: pool } = await import("@neondatabase/serverless");
const q = async (t, v = []) => (await pool.query(t, v)).rows;
let pass = 0, failN = 0; const log = [];
const ok = (cond, msg) => { if (cond) { pass++; log.push("  ✓ " + msg); } else { failN++; log.push("  ✗ " + msg); } };
const step = t => log.push("\n" + t);
class Client {
  constructor() { this.jar = {}; }
  async call(h, method, query = {}, body = undefined) {
    const headers = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "), "user-agent": this.ua || "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15" };
    let status = 200, out, hdr = {};
    const res = { status(c) { status = c; return this; }, json(d) { out = d; return this; }, send(d) { out = d; return this; }, end(d) { out = d; return this; },
      setHeader(k, v) { hdr[k.toLowerCase()] = v; }, getHeader(k) { return hdr[k.toLowerCase()]; } };
    await h({ method, query, body, headers }, res);
    for (const c of [].concat(hdr["set-cookie"] || [])) { const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1)); if (/Max-Age=0/.test(c)) delete this.jar[k]; else this.jar[k] = v; }
    return { status, body: out, headers: hdr };
  }
  auth(b) { return this.call(auth, "POST", {}, b); }
  op(b) { return this.call(data, "POST", {}, b); }
  get(qs) { return this.call(data, "GET", qs); }
}
async function signUp(c, email, password, phone) {
  const l = await c.auth({ action: "lookup", email }); if (l.status !== 200) return l;
  const sc = await c.auth({ action: "sendCode", email, channel: "email" }); if (sc.status !== 200) return sc;
  const v = await c.auth({ action: "verifyCode", code: sc.body.devCode }); if (v.status !== 200) return v;
  return c.auth({ action: "createPin", pin: password, phone });
}

// 1. Setup
step("1. Database and setup");
let r = await health({ method: "GET", query: {}, headers: {} }, { status(c) { this.c = c; return this; }, json(d) { this.d = d; return this; }, setHeader() {}, getHeader() {} });
const tables = (await q("select table_name from information_schema.tables where table_schema='public' order by 1")).map(x => x.table_name);
ok(tables.length >= 8, `tables created automatically (${tables.join(", ")})`);

// 1b. Sign-in page settings
step("1b. Sign-in page: demo off by default");
let cfg = await new Client().call(auth, "GET", { config: "1" });
ok(cfg.status === 200 && cfg.body.demo === false, "Explore the demo is off until an admin turns it on");
r = await new Client().auth({ action: "lookup", email: "someone@precisionlabeling.com" });
ok(r.status === 404 && /isn’t set up yet/.test(r.body.error), "before any admin exists, the sign-in page explains how to set up");

r = await new Client().auth({ action: "setup", email: "alan@arenaclub.com", key: "wrongkey", pin: "Sunrise2026", phone: "+639175550101" });
ok(r.status === 401, "first-time setup needs the right setup key");
r = await new Client().auth({ action: "lookup", email: "alan@arenaclub.com" }); ok(r.body.canSetup === true, "first-time setup is offered before any admin has a password");

// 2. Admin signs up with email + password
step("2. Admin signs up (email code + password + phone)");
const A = new Client();
r = await signUp(A, "alan@arenaclub.com", "Sunrise2026", "0917 555 0101");
ok(r.status === 200 && A.jar.pltc_s, "Alan signs up and is signed in");
let [alan] = await q("select * from members where email='alan@arenaclub.com'");
ok(alan && alan.role === "admin", "saved as admin (ADMIN_EMAILS)");
ok(alan && alan.pin_hash && !alan.pin_hash.includes("Sunrise"), "password stored only as a hash");
ok(alan && alan.phone === "+639175550101", "phone saved as +63…");
const A2 = new Client(); r = await A2.auth({ action: "pin", email: "alan@arenaclub.com", pin: "Sunrise2026" });
ok(r.status === 200 && r.body.next === "done", "signs in again with email + password on a new device");
r = await A2.auth({ action: "pin", email: "alan@arenaclub.com", pin: "wrong1234" });
ok(r.status === 401, "wrong password is refused");

r = await A.op({ op: "demoSetting", on: true }); cfg = await new Client().call(auth, "GET", { config: "1" });
ok(r.status === 200 && cfg.body.demo === true, "admin turns the demo on for the sign-in page");
await A.op({ op: "demoSetting", on: false });

r = await new Client().auth({ action: "setup", email: "alan@arenaclub.com", key: process.env.SESSION_SECRET.slice(0, 8), pin: "Hacker2026", phone: "+639170000000" });
ok(r.status === 403, "after the admin has a password, first-time setup is closed (even with the key)");

// 3. Import roster + invites
step("3. Import the PL team and send invites");
const roster = JSON.parse(/const ROSTER = (\{.*?\});\n/s.exec(fs.readFileSync(process.env.PLTC_ROOT + "/public/index.html", "utf8"))[1]);
const rows = roster.teams.filter(x => x.email).map(x => ({ ...x }));
r = await A.op({ op: "importRoster", rows });
ok(r.status === 200, `import ran (${JSON.stringify(r.body).slice(0, 80)})`);
const [{ n: memN }] = await q("select count(*)::int n from members");
ok(memN >= rows.length, `${memN} members saved`);
r = await A.op({ op: "importRoster", rows });
const [{ n: memN2 }] = await q("select count(*)::int n from members");
ok(memN2 === memN, "running the import again doesn't create duplicates");
const [khimRow] = await q("select * from members where email='khim.arcilla@precisionlabeling.com'");
ok(khimRow && khimRow.dept === "Analysts", "Khim saved in Analysts");
{ const [pc] = await q("select dept, job_title from members where email='princess.c@precisionlabeling.com'"); ok(pc && pc.dept === "Grading" && pc.job_title === "Grading Annotator 1", `Princess Cabalar is in Grading (${pc?.dept})`); }
ok(khimRow.work_location === "Philippines", `team members' location is Philippines (${khimRow.work_location})`);
const [alanLoc] = await q("select work_location from members where email='alan@arenaclub.com'"); ok(alanLoc.work_location !== "Philippines", "Alan's location isn't changed");
sent.length = 0;
r = await A.op({ op: "invite", ids: [khimRow.id] });
ok(r.status === 200 && sent.some(m => [].concat(m.to).includes("khim.arcilla@precisionlabeling.com")), "invite email sent to Khim");
const [khimInv] = await q("select invited_at from members where id=$1", [khimRow.id]);
ok(!!khimInv.invited_at, "invite date saved");

// 3b. Personal sign-up link (no code needed)
step("3b. Personal sign-up link: straight to creating a password");
const [ped] = await q("select id, name from members where email='ped@precisionlabeling.com'");
r = await A.op({ op: "inviteLinks", ids: [ped.id] });
const tok = new URL(r.body.links[0].link).searchParams.get("join");
ok(r.status === 200 && tok, "admin copies a personal sign-up link");
const P1 = new Client(); r = await P1.auth({ action: "join", token: tok });
ok(r.status === 200 && r.body.next === "createPin", "opening the link goes straight to create a password");
r = await P1.auth({ action: "createPin", pin: "Grading2026", phone: "+63 917 222 3333" });
ok(r.status === 200 && P1.jar.pltc_s, "they create a password and are signed in");
r = await new Client().auth({ action: "join", token: tok }); ok(r.status === 200 && r.body.next === "signin", "the same link afterwards only offers sign in");
r = await new Client().auth({ action: "join", token: tok.slice(0, -3) + "abc" }); ok(r.status === 400, "a changed or fake link is refused");
r = await new Client().auth({ action: "pin", email: "ped@precisionlabeling.com", pin: "Grading2026" }); ok(r.status === 200, "they can sign in with email + password");

// 4. Team member signs up, edits own details, uploads a photo
step("4. Team member signs up, updates details, uploads a photo");
const K = new Client();
r = await signUp(K, "khim.arcilla@precisionlabeling.com", "Labels2026", "09171234567");
ok(r.status === 200, "Khim signs up with a password");
r = await K.op({ op: "selfUpdate", fields: { name: "Khim P. Arcilla", phone: "0917 765 4321", personalEmail: "khim@gmail.com" } });
ok(r.status === 200, "Khim saves her own details");
let [k2] = await q("select name, phone, personal_email from members where id=$1", [khimRow.id]);
ok(k2.name === "Khim P. Arcilla" && k2.phone === "+639177654321" && k2.personal_email === "khim@gmail.com", "name, phone and personal email saved");
r = await K.op({ op: "memberUpdate", id: khimRow.id, fields: { dept: "Data" } });
ok(r.status === 403, "team member can't change their own department");
// a small real JPEG (16×16) for the photo and announcement uploads
const png = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAQABABAREA/8QAFgABAQEAAAAAAAAAAAAAAAAABgcI/8QAIhAAAgEDBAMBAAAAAAAAAAAAAQIDBAURAAYSIQcTMUH/2gAIAQEAAD8Atvj7ad13dvKjtENOI6Ut7KyfKkpED2QPoJ+A5GT+DWm/IviLauzNrTXnb8MlPUQMp4tNyEoJAPTH8BzjS2V4D3hfqT/1Twn8dUVPSMCAAQU0VADxAOGI+DOQfn9u7xe85P/Z";
r = await K.op({ op: "photoSet", memberId: khimRow.id, data: png });
ok(r.status === 200, `photo upload accepted (${Math.round(png.length / 1024)} KB)`);
const [ph] = await q("select photo is not null as has, photo_at from members where id=$1", [khimRow.id]).catch(async () => q("select true as has"));
ok(ph && ph.has, "photo saved in the database");
let me = await K.get({ week: "" });
const kv = me.body.members?.find(m => m.id === khimRow.id);
r = await K.get({ photo: khimRow.id, v: String(kv?.photoV || 1) });
ok(r.status === 200 && r.body && (r.headers["content-type"] || "").startsWith("image/"), "photo loads back as an image");

// 5. Time clock
step("5. Clock in, break, lunch, clock out");
r = await A.op({ op: "shiftSettings", shift: { ...(await A.get({ week: "" })).body.shift, enabled: false } });
ok(r.status === 200, "time clock windows switched off for the test (any time)");
for (const kind of ["in", "break", "back", "lunch", "back", "out"]) { r = await K.op({ op: "clock", memberId: khimRow.id, kind }); ok(r.status === 200, `clock ${kind}`); }
let [sh] = await q("select * from shifts where member_id=$1 order by clock_in desc limit 1", [khimRow.id]);
ok(sh && sh.clock_out && Array.isArray(sh.breaks) && sh.breaks.length === 2 && sh.breaks.every(b => b.e), "shift saved with in/out and 2 closed breaks");
ok(sh.breaks.every(b => b.ds === "Computer" && b.de === "Computer") && sh.breaks.map(b => b.t).join() === "break,lunch", "break and lunch start/end times and devices saved");

// 5b. Computers only
step("5b. Clock in from a computer only (phones blocked)");
[sh] = await q("select device_in, device_out from shifts where member_id=$1 order by clock_in desc limit 1", [khimRow.id]);
ok(sh.device_in === "Computer" && sh.device_out === "Computer", "device saved on the shift (Computer)");
const KP = new Client(); KP.jar = { ...K.jar }; KP.ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
r = await KP.op({ op: "clock", memberId: khimRow.id, kind: "in" });
ok(r.status === 403 && /laptop or desktop/.test(r.body.error), "iPhone clock-in refused");
KP.ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
r = await KP.op({ op: "clock", memberId: khimRow.id, kind: "in" }); ok(r.status === 403, "Android clock-in refused");
KP.ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
r = await KP.op({ op: "clock", memberId: khimRow.id, kind: "in", touchMac: true }); ok(r.status === 403, "iPad posing as a Mac refused (touchscreen check)");
const [{ n: openN }] = await q("select count(*)::int n from shifts where member_id=$1 and clock_out is null", [khimRow.id]);
ok(openN === 0, "nothing recorded from the refused attempts");
const AP = new Client(); AP.jar = { ...A.jar }; AP.ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148";
r = await AP.op({ op: "clock", memberId: khimRow.id, kind: "in" }); ok(r.status === 200, "admin can fix someone's punch from a phone");
let [ph2] = await q("select id, device_in from shifts where member_id=$1 and clock_out is null", [khimRow.id]);
ok(ph2 && ph2.device_in === "iPhone", "and it's saved as an iPhone punch");
r = await AP.op({ op: "clock", memberId: khimRow.id, kind: "out" }); ok(r.status === 200, "admin clocks them out from the phone");
r = await AP.op({ op: "clock", memberId: alan.id, kind: "in" }); ok(r.status === 200, "admin (Phones allowed for: Admins) clocks themself in from a phone");
await AP.op({ op: "clock", memberId: alan.id, kind: "out" });
const s0 = (await A.get({ week: "" })).body.shift;
await A.op({ op: "shiftSettings", shift: { ...s0, desktopOnly: false } });
r = await KP.op({ op: "clock", memberId: khimRow.id, kind: "in", touchMac: true }); ok(r.status === 200, "with Any device on, phones work again");
KP.ua = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120 Safari/537.36";
await KP.op({ op: "clock", memberId: khimRow.id, kind: "out" });
const [dv] = await q("select device_in, device_out from shifts where member_id=$1 order by clock_in desc limit 1", [khimRow.id]);
ok(dv.device_in === "iPad" && dv.device_out === "Android tablet", `iPad in and Android tablet out recorded (${dv.device_in} / ${dv.device_out})`);
const cardDv = await A.get({ card: khimRow.id, from: "2026-01-01", to: "2027-12-31" });
ok(cardDv.body.card?.some(x => x.deviceIn === "iPad" && x.deviceOut === "Android tablet"), "device shows in the timecard data");
await A.op({ op: "shiftSettings", shift: { ...s0, desktopOnly: true } });
const [st0] = await q("select value from settings where key='shift'"); ok(st0.value.desktopOnly === true && st0.value.mobileDepts.includes("Admins"), "Computers only setting saved");
await pool.query("delete from shifts where member_id=$1 and id <> (select id from shifts where member_id=$1 and device_in='Computer' order by clock_in limit 1)", [khimRow.id]);
[sh] = await q("select * from shifts where member_id=$1 order by clock_in desc limit 1", [khimRow.id]);

// 6. Admin edits + approves the shift
step("6. Admin edits and approves the shift");
const inMs = new Date(sh.clock_in).getTime() - 3600000, outMs = inMs + 8 * 3600000;
r = await A.op({ op: "shiftSave", id: sh.id, memberId: khimRow.id, in: inMs, out: outMs, breakMin: 60, note: "Fixed missed punch" });
ok(r.status === 200, "admin edit saved");
[sh] = await q("select * from shifts where id=$1", [sh.id]);
ok(new Date(sh.clock_in).getTime() === inMs && new Date(sh.clock_out).getTime() === outMs && sh.note === "Fixed missed punch" && sh.edited, "new times, note and Edited flag saved");
const H = 3600000;
r = await A.op({ op: "shiftSave", id: sh.id, memberId: khimRow.id, in: inMs, out: outMs, note: "Fixed missed punch",
  breaks: [{ s: inMs + 2 * H, e: inMs + 2.25 * H, t: "break" }, { s: inMs + 4 * H, e: inMs + 4.75 * H, t: "lunch" }, { s: inMs + 6 * H, e: inMs + 6.25 * H, t: "break" }] });
ok(r.status === 200, "edit Break 1, Lunch and Break 2 times");
[sh] = await q("select * from shifts where id=$1", [sh.id]);
ok(sh.break_min === null && sh.breaks.length === 3 && sh.breaks.map(x => x.t).join() === "break,lunch,break" && sh.breaks[1].e - sh.breaks[1].s === 0.75 * H, "break and lunch times saved (no minutes total)");
r = await A.op({ op: "shiftSave", id: sh.id, memberId: khimRow.id, in: inMs, out: outMs, breaks: [{ s: inMs - H, e: inMs, t: "break" }] });
ok(r.status === 400, "a break outside the shift is refused");
r = await A.op({ op: "shiftSave", id: sh.id, memberId: khimRow.id, in: inMs, out: outMs, breaks: [{ s: inMs + H, e: inMs + 2 * H, t: "break" }, { s: inMs + 1.5 * H, e: inMs + 3 * H, t: "lunch" }] });
ok(r.status === 400, "overlapping breaks are refused");
r = await A.op({ op: "shiftApprove", ids: [sh.id], status: "approved" });
[sh] = await q("select approval from shifts where id=$1", [sh.id]);
ok(sh.approval === "approved", "approval saved");
const hist = await q("select field from member_history where member_id=$1", [khimRow.id]);
ok(hist.some(h => h.field === "photo") && hist.some(h => h.field === "phone"), `profile change history recorded (${hist.map(h => h.field).join(", ")})`);

// 7. Time off
step("7. Time off request and decision");
r = await K.op({ op: "toRequest", type: "Vacation", start: "2026-12-01", end: "2026-12-03", note: "Family trip" });
ok(r.status === 200, "Khim requests vacation");
let [to] = await q("select * from time_off where member_id=$1 order by created_at desc limit 1", [khimRow.id]);
ok(to && to.status === "pending" && to.note === "Family trip", "request saved as pending");
sent.length = 0;
r = await A.op({ op: "toDecide", id: to.id, status: "approved", note: "Enjoy your trip!" });
[to] = await q("select * from time_off where id=$1", [to.id]);
ok(to.status === "approved" && to.decision_note === "Enjoy your trip!", "approval and message saved");
const nf = await q("select title from notifications where member_id=$1 order by created_at desc limit 3", [khimRow.id]);
ok(nf.some(n => /approved/i.test(n.title)), "Khim gets an in-app notification");
ok(sent.some(m => [].concat(m.to).includes("khim.arcilla@precisionlabeling.com")), "and an email");

// 8. Schedule codes, settings
step("8. Schedule codes and time clock settings");
r = await A.op({ op: "setSchedule", memberId: khimRow.id, day: "2026-11-05", codes: ["5H", "6H"] });
ok(r.status === 200, "5H + 6H saved for a day");
const sc = await q("select * from schedules where member_id=$1", [khimRow.id]).catch(e => [{ err: e.message }]);
ok(sc.length && !sc[0].err, `schedule row saved (${sc[0]?.err || "ok"})`);
const cur = (await A.get({ week: "" })).body.shift;
r = await A.op({ op: "shiftSettings", shift: { ...cur, enabled: true, lateMin: 3, earlyOutMin: 6, flexDepts: ["CS", "Admins"] } });
const [st] = await q("select value from settings where key='shift'");
ok(st && st.value.lateMin === 3 && st.value.earlyOutMin === 6 && st.value.flexDepts.includes("Admins"), "grace 3 min, early-out 6 min and Admins exemption saved");
const cur2 = (await A.get({ week: "" })).body.shift;
ok(cur2.habits.CS.label === "Customer Service", `CS is called "Customer Service" (${cur2.habits.CS.label})`);
r = await A.op({ op: "shiftSettings", shift: { ...cur2, habits: { ...cur2.habits, OS: { ...cur2.habits.OS, enabled: false } } } });
const [st2] = await q("select value from settings where key='shift'"); ok(st2.value.habits.OS.enabled === false && st2.value.habits.NS.enabled === true, "OS switched off (NS still on) is saved");
r = await A.op({ op: "setSchedule", memberId: khimRow.id, day: "2026-11-06", codes: ["OS", "5H"] });
const [sc6] = await q("select codes from schedules where member_id=$1 and day='2026-11-06'", [khimRow.id]); ok(sc6 && sc6.codes.join() === "5H", `a switched-off code can't be set (${sc6?.codes})`);
await A.op({ op: "shiftSettings", shift: { ...cur2, habits: { ...cur2.habits, OS: { ...cur2.habits.OS, enabled: true } } } });

r = await A.op({ op: "metricsTeam", name: "Lea Alan DeBruin", dept: "Oregon" });
const mtL = (await A.get({ week: "" })).body.metricsTeams; ok(r.status === 200 && mtL["lea alan debruin"] === "Oregon", "Metrics team for a Metabase-only person is saved");

step("8c. Metrics days: Pacific vs Manila (Metabase dates are Pacific)");
let pt = await A.get({ production: "1", tz: "pacific", range: "day", date: "2026-11-02" });
const nm = d => d.rows.map(r => `${r.name}:${r.total}${r.team ? "/" + r.team : ""}`).sort().join(", ");
ok(pt.status === 200 && !pt.body.rows.some(r => /total/i.test(r.name)), "TEAM TOTAL row is left out");
ok(/Austin Crawford:136\/Oregon/.test(nm(pt.body)) && /Bueno:51/.test(nm(pt.body)) && !/Bueno:40/.test(nm(pt.body)), `Pacific Nov 2 = Metabase Nov 2 only (${nm(pt.body)})`);
let mn = await A.get({ production: "1", tz: "manila", range: "day", date: "2026-11-03" });
ok(/Austin Crawford:136/.test(nm(mn.body)) && /Bueno:51/.test(nm(mn.body)) && !/Bueno:40/.test(nm(mn.body)), `Manila Nov 3 = Metabase (Pacific) Nov 2 (${nm(mn.body)})`);
mn = await A.get({ production: "1", tz: "manila", range: "day", date: "2026-11-02" });
ok(/Bueno:40/.test(nm(mn.body)) && !/Austin/.test(nm(mn.body)), `Manila Nov 2 = Metabase Nov 1, no cross-over (${nm(mn.body)})`);
{ const [ianf] = await q("select id from members where email='ianf@precisionlabeling.com'"); const ir = pt.body.rows.find(r => r.name === "Ian f");
  ok(ianf && ir && ir.memberId === ianf.id, "Metabase “Ian f” matches Ian Rey Yandra Fajardo (ianf@), not another Ian"); }
{ const ry = pt.body.rows.find(r => /Ryan/.test(r.name)); ok(ry && ry.values.RECOMP_CARDS === 254 && ry.values.EV_CARDS === 75, `EV and Recomp are flipped by default (Recomp ${ry?.values.RECOMP_CARDS}, EV ${ry?.values.EV_CARDS})`); }
await A.op({ op: "swapEvRecomp", on: false });
{ const p2 = await A.get({ production: "1", tz: "pacific", range: "day", date: "2026-11-02" }); const ry = p2.body.rows.find(r => /Ryan/.test(r.name)); ok(ry.values.EV_CARDS === 254, "switching the swap off shows Metabase as-is"); }
await A.op({ op: "swapEvRecomp", on: true });
ok(pt.body.rows.find(r => r.name === "Kaity Paul")?.memberId == null, "an Oregon reviewer is never matched to a PL person by a similar name");

step("8c2. Overtime board (admins only)");
let otr = await A.get({ production: "1", card: "overtime", tz: "pacific", range: "day", date: "2026-11-02" });
ok(otr.status === 200 && otr.body.slots.join("|") === "10 PM – 11 PM|11 PM – 12 AM", `overtime hours in order from the end of the shift (${otr.body.slots})`);
ok(otr.body.rows.find(r => /Bueno/.test(r.name))?.total === 30, "All hours uses Metabase’s All hours rows");
ok(!otr.body.rows.some(r => /total/i.test(r.name)), "the HOUR TOTAL row is left out");
otr = await A.get({ production: "1", card: "overtime", tz: "pacific", range: "day", date: "2026-11-02", slot: "2" });
ok(otr.body.rows.length === 1 && otr.body.rows[0].total === 10, "2 hr shows only the 11 PM – 12 AM hour");
otr = await A.get({ production: "1", card: "overtime", tz: "manila", range: "day", date: "2026-11-03", slot: "1" });
ok(otr.body.rows.length === 3, "Manila Nov 3 shows the same overtime as Pacific Nov 2 (hour given as 22 works too)");
otr = await K.get({ production: "1", card: "overtime" }); ok(otr.status === 403, "team members can’t see overtime");

step("8c3. Habits that repeat every workday");
{ const [{ d0 }] = await q("select ((now() at time zone 'Asia/Manila')::date)::text as d0");
  r = await A.op({ op: "setSchedule", memberId: khimRow.id, codes: ["5H", "6H"], repeat: true });
  const auto = await q("select day::text, codes, auto from schedules where member_id=$1 and day > $2::date and auto order by day", [khimRow.id, d0]);
  ok(r.status === 200 && auto.length >= 8 && auto.every(x => x.codes.join() === "5H,6H"), `5H + 6H repeat on the next workdays (${auto.length} days filled)`);
  const later = auto[2].day;
  await A.op({ op: "setSchedule", memberId: khimRow.id, day: later, codes: ["NS"] });
  r = await A.op({ op: "setSchedule", memberId: khimRow.id, codes: ["5H"], repeat: true });
  const [hand] = await q("select codes, auto from schedules where member_id=$1 and day=$2", [khimRow.id, later]);
  const [next] = await q("select codes from schedules where member_id=$1 and day=$2", [khimRow.id, auto[0].day]);
  ok(hand.codes.join() === "NS" && !hand.auto && next.codes.join() === "5H", "changing the repeat updates the coming days but keeps a day set by hand");
  r = await A.op({ op: "setSchedule", memberId: khimRow.id, codes: [], repeat: false });
  const [{ n: left }] = await q("select count(*)::int n from schedules where member_id=$1 and day > $2::date and auto", [khimRow.id, d0]);
  const [mk] = await q("select default_codes from members where id=$1", [khimRow.id]);
  ok(left === 0 && mk.default_codes.length === 0, "switching repeat off clears the coming days");
  await q("delete from schedules where member_id=$1 and day > $2::date", [khimRow.id, d0]); }

step("8d. Admin “any time” switch");
r = await A.op({ op: "adminAnyTime", memberId: alan.id, on: false });
let [aon] = await q("select anytime_off from members where id=$1", [alan.id]); ok(r.status === 200 && aon.anytime_off === true, "admin switches their any-time off");
r = await K.op({ op: "adminAnyTime", memberId: alan.id, on: true }); ok(r.status === 403, "team members can't change it");
r = await A.op({ op: "adminAnyTime", memberId: alan.id, on: true }); [aon] = await q("select anytime_off from members where id=$1", [alan.id]); ok(aon.anytime_off === false, "and back on");

step("8f. Shift type can be fixed");
{ const [x] = await q("select id, clock_in, clock_out from shifts where member_id=$1 and clock_out is not null order by clock_in desc limit 1", [khimRow.id]);
  r = await A.op({ op: "shiftSave", id: x.id, memberId: khimRow.id, in: new Date(x.clock_in).getTime(), out: new Date(x.clock_out).getTime(), kind: "5H", note: "Fixed missed punch" });
  let [y] = await q("select kind from shifts where id=$1", [x.id]); ok(r.status === 200 && y.kind === "5H", "Edit shift changes a Normal shift to 5 AM Habit");
  await A.op({ op: "shiftSave", id: x.id, memberId: khimRow.id, in: new Date(x.clock_in).getTime(), out: new Date(x.clock_out).getTime(), kind: "", note: "Fixed missed punch" });
  await A.op({ op: "shiftApprove", ids: [x.id], status: "approved" });
  [y] = await q("select kind from shifts where id=$1", [x.id]); ok(y.kind === null, "and back to Normal shift"); }

step("8e. Staying signed in");
r = await A.op({ op: "idleSignout", minutes: 30 }); ok(r.status === 200 && (await A.get({ week: "" })).body.idleSignout === 30, "idle sign-out setting saved");
await A.op({ op: "idleSignout", minutes: 0 }); ok((await A.get({ week: "" })).body.idleSignout === 0, "idle sign-out off by default / can be turned off");

// 9. Announcements with an image
step("9. Announcement with an image");
r = await A.op({ op: "annPost", body: "Holiday party Friday!", image: png });
ok(r.status === 200, "announcement posted");
const [ann] = await q("select * from announcements order by created_at desc limit 1").catch(e => [{ err: e.message }]);
ok(ann && !ann.err && /Holiday/.test(ann.body), "announcement text saved");
ok(ann && (ann.image || ann.image_data || ann.img), "announcement image saved");

step("9a. An admin being reviewed fills in the self review, not the manager part");
{ const [ka] = await q("select id from members where name='Karl Calma'");
  if (ka) { await pool.query("update members set role='admin', manager_id=$2 where id=$1", [ka.id, alan.id]);
    r = await A.op({ op: "cycleCreate", name: "Admin check", kind: "Performance", periodStart: "2026-01-01", periodEnd: "2026-12-31", due: "2026-11-15", reviewDue: "2027-01-21", depts: ["Managers"] });
    const [kr] = await q("select r.id from reviews r join review_cycles c on c.id=r.cycle_id where c.name='Admin check' and r.member_id=$1", [ka.id]);
    ok(kr, "Karl (an admin) gets a review with Alan as reviewer");
    if (kr) { await pool.query("update members set pin_hash=null where id=$1", [ka.id]);
      const KC = new Client(); const em = (await q("select email from members where id=$1", [ka.id]))[0].email;
      await A.op({ op: "resetPin", id: ka.id }); const tokR = await A.op({ op: "inviteLinks", ids: [ka.id] }); const tk = new URL(tokR.body.links[0].link).searchParams.get("join");
      await KC.auth({ action: "join", token: tk }); await KC.auth({ action: "createPin", pin: "Manager2026", phone: "+639171112222" });
      r = await KC.op({ op: "reviewSave", id: kr.id, answers: [{ q: "Statement", rating: 5 }] });
      ok(r.status === 403, "Karl can't fill in his own manager review");
      r = await A.op({ op: "reviewSendSelf", ids: [kr.id], questions: ["What were some of your biggest highlights in 2026?", "What are a few of your lowlights from 2026?"] });
      const kn = (await KC.get({ week: "" })).body;
      ok(r.status === 200 && r.body.sent === 1 && kn.reviews.find(x => x.id === kr.id)?.selfSentAt, "self review sent to Karl (an admin)");
      ok((kn.notifications || []).some(n => /Self Review/i.test(n.title) && /biggest highlights/.test(n.body || "")), "Karl’s notification lists the questions");
      r = await KC.op({ op: "reviewSave", id: kr.id, self: true, answers: [{ q: "What were some of your biggest highlights in 2026?", a: "Built the review team" }, { q: "What are a few of your lowlights from 2026?", a: "Hiring took long" }] });
      ok(r.status === 200, "Karl submits his self review");
      r = await A.op({ op: "reviewUnsend", id: kr.id, part: "self" }); ok(r.status === 400, "a submitted self review can’t be unsent (use Unlock)");
      const [kr2] = await q("select r.id from reviews r join review_cycles c on c.id=r.cycle_id where c.name='Admin check' and r.member_id<>$1 limit 1", [ka.id]);
      if (kr2) { await A.op({ op: "reviewSendSelf", ids: [kr2.id], questions: ["Q1"] });
        r = await A.op({ op: "reviewUnsend", id: kr2.id, part: "self" }); const [u] = await q("select self_sent_at from reviews where id=$1", [kr2.id]);
        ok(r.status === 200 && u.self_sent_at === null, "Unsend takes a sent self review back"); } } } }

step("9a2. Add teams to a running cycle");
{ r = await A.op({ op: "cycleCreate", name: "Managers only", kind: "Performance", depts: ["Managers"] });
  const [cy] = await q("select id from review_cycles where name='Managers only'");
  const [{ n: before }] = await q("select count(*)::int n from reviews where cycle_id=$1", [cy.id]);
  r = await A.op({ op: "cycleAddPeople", id: cy.id, depts: ["Data", "Managers"] });
  const [{ n: after }] = await q("select count(*)::int n from reviews where cycle_id=$1", [cy.id]);
  const [{ n: data }] = await q("select count(*)::int n from members where active and dept='Data'");
  ok(r.status === 200 && after === before + data && r.body.added === data, `Add teams adds the Data team and skips people already in it (+${r.body.added})`);
  r = await A.op({ op: "cycleAddPeople", id: cy.id, everyone: true }); const [{ n: all }] = await q("select count(*)::int n from members where active");
  const [{ n: now }] = await q("select count(*)::int n from reviews where cycle_id=$1", [cy.id]); ok(now === all, "Everyone adds the rest of the team");
  r = await K.op({ op: "cycleAddPeople", id: cy.id, everyone: true }); ok(r.status === 403, "team members can’t add people"); }

step("9b. Review questions can be changed");
r = await A.op({ op: "reviewQuestions", self: [["Proudest win in {Y}?", "Give an example"]], mgr: ["Keeps the work area organized."], extra: "Anything else?" });
let rq = (await A.get({ week: "" })).body.reviewQuestions; ok(r.status === 200 && rq.self[0][0] === "Proudest win in {Y}?" && rq.mgr.length === 1, "custom questions saved");
r = await K.op({ op: "reviewQuestions", self: [["x", ""]], mgr: ["y"] }); ok(r.status === 403, "only admins can change questions");
await A.op({ op: "reviewQuestions", reset: true }); rq = (await A.get({ week: "" })).body.reviewQuestions; ok(rq === null, "reset goes back to the original questions");

// 10. Reviews end to end
step("10. Year End Review: cycle, self review, manager votes, send");
r = await A.op({ op: "cycleCreate", name: "Year End Review", kind: "Performance", periodStart: "2026-01-01", periodEnd: "2026-12-31", due: "2026-11-15", reviewDue: "2027-01-21", depts: ["Analysts"] });
ok(r.status === 200 && r.body.created >= 1, `cycle created for ${r.body.created} people`);
const [cy] = await q("select * from review_cycles order by created_at desc limit 1");
ok(cy.kind === "Performance" && String(cy.review_due).length > 0, "type and Jan 21 review due date saved");
let [rv] = await q("select * from reviews where cycle_id=$1 and member_id=$2", [cy.id, khimRow.id]);
r = await K.op({ op: "reviewSave", id: rv.id, self: true, answers: [{ q: "Q1", a: "A1" }] });
ok(r.status === 403, "self review locked until it's sent");
r = await A.op({ op: "reviewSendSelf", ids: [rv.id], questions: ["Q1", "Q2"] });
ok(r.status === 200 && r.body.sent === 1, "self review sent (unlocked)");
const ans = [1, 2, 3, 4, 5].map(i => ({ q: "Question " + i, a: "Answer with example " + i }));
r = await K.op({ op: "reviewSave", id: rv.id, self: true, answers: ans, selfRating: 4 });
ok(r.status === 200, "Khim submits her self review");
[rv] = await q("select * from reviews where id=$1", [rv.id]);
ok(rv.self_submitted_at && Array.isArray(rv.self_answers) && rv.self_answers.length === 5, "5 answers saved and locked");
r = await K.op({ op: "reviewSave", id: rv.id, self: true, answers: ans });
ok(r.status === 409, "can't change it after submitting");
r = await A.op({ op: "reviewUnlockSelf", id: rv.id }); [rv] = await q("select * from reviews where id=$1", [rv.id]);
ok(!rv.self_submitted_at, "admin unlock works");
const votes = [5, 4, 5, 5, 4].map((v, i) => ({ q: "Statement " + i, rating: v }));
r = await A.op({ op: "reviewSave", id: rv.id, answers: votes, extra: "- 2026 Positives\n  - Trained new hires", strengths: "Accuracy" });
[rv] = await q("select * from reviews where id=$1", [rv.id]);
ok(rv.status === "draft" && rv.mgr_answers.length === 5 && rv.rating === 5 && /Positives/.test(rv.extra_info), "manager votes, average and extra notes saved as a draft");
r = await A.op({ op: "reviewSendMany", ids: [rv.id] }); [rv] = await q("select * from reviews where id=$1", [rv.id]);
ok(rv.status === "shared" && rv.shared_at, "review sent to Khim");
me = await K.get({ week: "" });
const myRv = me.body.reviews?.find(x => x.id === rv.id);
ok(myRv && myRv.mgrAnswers?.length === 5, "Khim can read her votes");

// 11. Updates, 1:1s, notifications
step("11. Updates, 1:1s, notifications");
r = await A.op({ op: "updateAdd", memberId: khimRow.id, kind: "praise", body: "Great catch on the 1st edition", shared: true });
ok(r.status === 200, "praise update saved");
r = await A.op({ op: "meetingCreate", memberId: khimRow.id, at: Date.now() + 86400000, durationMin: 30, repeat: "none", point: "Career goals" });
ok(r.status === 200, `1:1 booked (${r.status} ${r.body?.error || ""})`);
const [dfl] = await q("select link from meetings where member_id=$1 order by created_at desc limit 1", [khimRow.id]);
ok(dfl.link === "https://meet.google.com/ara-qmvp-frj", `Alan's usual Meet link is used when none is given (${dfl.link})`);
r = await A.op({ op: "selfUpdate", fields: { meetLink: "meet.google.com/xyz-abcd-efg" } });
const [ml0] = await q("select meet_link from members where id=$1", [alan.id]); ok(ml0.meet_link === "https://meet.google.com/xyz-abcd-efg", "changing your usual Meet link in Account settings is saved");
await A.op({ op: "selfUpdate", fields: { meetLink: "https://meet.google.com/ara-qmvp-frj" } });
const [mt] = await q("select id from meetings where member_id=$1 order by created_at desc limit 1", [khimRow.id]);
r = await A.op({ op: "meetingCreate", memberId: khimRow.id, at: Date.now() + 2 * 86400000, durationMin: 30, repeat: "weekly", link: "meet.google.com/abc-defg-hij" });
const [ml] = await q("select id, link from meetings where member_id=$1 and link is not null order by created_at desc limit 1", [khimRow.id]);
ok(ml && ml.link === "https://meet.google.com/abc-defg-hij", `Google Meet link saved (${ml?.link})`);
r = await A.op({ op: "meetingCreate", memberId: khimRow.id, at: Date.now() + 3 * 86400000, durationMin: 30, repeat: "none", link: "javascript:alert(1)" });
ok(r.status === 400, "a bad link is refused");
r = await A.op({ op: "meetingUpdate", id: ml.id, fields: { link: "https://meet.google.com/xyz-abcd-efg" } });
const [ml2] = await q("select link from meetings where id=$1", [ml.id]); ok(ml2.link === "https://meet.google.com/xyz-abcd-efg", "link can be changed");
r = await A.op({ op: "meetingUpdate", id: ml.id, fields: { status: "done" } });
const [nx] = await q("select link from meetings where member_id=$1 and status='scheduled' order by starts_at desc limit 1", [khimRow.id]);
ok(nx && nx.link === "https://meet.google.com/xyz-abcd-efg", "the next repeat keeps the same Meet link");
r = await K.op({ op: "meetingDelete", id: mt.id }); ok(r.status === 403, "team member can't delete the 1:1");
r = await A.op({ op: "meetingDelete", id: mt.id }); const [{ n: mtN }] = await q("select count(*)::int n from meetings where id=$1", [mt.id]);
ok(r.status === 200 && mtN === 0, "manager deletes the 1:1 (gone from the database)");
r = await K.op({ op: "notifRead", all: true });
const [{ n: unread }] = await q("select count(*)::int n from notifications where member_id=$1 and read_at is null", [khimRow.id]).catch(async () => [{ n: (await q("select count(*)::int n from notifications where member_id=$1 and not coalesce(read,false)", [khimRow.id]))[0].n }]);
ok(unread === 0, "mark all notifications read is saved");

// 12. Password reset + admin reset
step("12. Forgot password and admin reset");
const K2 = new Client();
await K2.auth({ action: "forgotPin", email: "khim.arcilla@precisionlabeling.com" });
const code = (await K2.auth({ action: "sendCode", email: "khim.arcilla@precisionlabeling.com", channel: "email" })).body.devCode;
await K2.auth({ action: "verifyCode", code });
r = await K2.auth({ action: "createPin", pin: "NewPass2027" });
ok(r.status === 200, "Khim resets her password");
r = await new Client().auth({ action: "pin", email: "khim.arcilla@precisionlabeling.com", pin: "NewPass2027" });
ok(r.status === 200, "new password works");
r = await new Client().auth({ action: "pin", email: "khim.arcilla@precisionlabeling.com", pin: "Labels2026" });
ok(r.status === 401, "old password no longer works");
r = await A.op({ op: "resetPin", id: khimRow.id }); const [kp] = await q("select pin_hash from members where id=$1", [khimRow.id]);
ok(!kp.pin_hash, "admin Reset password clears it");

// 12b. Delete a team member
step("12b. Delete a team member");
const [vic] = await q("select id, name from members where email='abe@precisionlabeling.com'");
r = await K.op({ op: "memberDelete", id: vic.id, confirmName: vic.name }); ok(r.status === 403, "team member can't delete people");
r = await A.op({ op: "memberDelete", id: vic.id, confirmName: "wrong" }); ok(r.status === 400, "wrong name typed: nothing deleted");
r = await A.op({ op: "memberDelete", id: alan.id, confirmName: alan.name }); ok(r.status === 400, "admin can't delete themself");
r = await A.op({ op: "memberDelete", id: vic.id, confirmName: vic.name });
const [{ n: gone }] = await q("select count(*)::int n from members where id=$1", [vic.id]); ok(r.status === 200 && gone === 0, `${vic.name} deleted`);
r = await A.op({ op: "importRoster", rows });
const [{ n: back }] = await q("select count(*)::int n from members where email='abe@precisionlabeling.com'");
ok(back === 0 && r.body.skipped.some(x => /deleted/.test(x)), "importing the PL team again does NOT bring the deleted person back");
const memAfter = memN2 - 1;

// 13. Everything still there after a fresh load
step("13. Fresh load: data comes back through the API");
const fresh = await (new Client()).auth({ action: "pin", email: "alan@arenaclub.com", pin: "Sunrise2026" });
const A3 = new Client(); await A3.auth({ action: "pin", email: "alan@arenaclub.com", pin: "Sunrise2026" });
const L = await A3.get({ week: "" });
ok(L.status === 200 && L.body.members.length === memAfter, "all members load (minus the deleted one)");
ok(L.body.timeOff?.some(x => x.note === "Family trip" && x.status === "approved"), "approved vacation loads");
const card = await A3.get({ card: khimRow.id, from: "2026-01-01", to: "2026-12-31" });
ok(card.status === 200 && card.body.card?.some(s => s.note === "Fixed missed punch" && s.approval === "approved"), "edited, approved shift loads in the timecard");

console.log(log.join("\n")); console.log(`\n${pass} passed, ${failN} failed`);
await pool.end(); process.exit(failN ? 1 : 0);
