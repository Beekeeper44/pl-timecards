import {
  sql, ensureSchema, body, send, fail, sign, unsign, cookies, setCookie, clearCookie,
  SESSION_HOURS, TRUST_DAYS, hashPin, newSalt, pinMatches, sha, sixDigits,
  maskPhone, maskEmail, normEmail, emailOk, normPhone, phoneOk, twilioStart, twilioCheck, sendEmailCode, devCodes, currentUser, setupMessage
} from "./_lib.js";

const CODE_MIN = 10, MAX_SENDS_PER_HOUR = 5, MAX_CODE_TRIES = 5, MAX_PIN_TRIES = 5, LOCK_MIN = 5;
// Sign-in is email + password. (Column and action names still say "pin" from the earlier PIN version; the hash is the same scrypt.)
// Returns an error message, or "" if the password is fine.
const pwProblem = (p, email = "") => {
  if (typeof p !== "string" || p.length < 8) return "Your password needs at least 8 characters.";
  if (p.length > 128) return "Your password can be at most 128 characters.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Use at least one letter and one number in your password.";
  if (email && p.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) return "Pick a password that doesn’t include your email name.";
  if (/^(password|passw0rd|12345678|qwerty12|abcd1234)/i.test(p)) return "That password is too easy to guess. Try another.";
  return "";
};
const trustName = uid => "pltc_t_" + uid.replace(/-/g, "").slice(0, 16);

function startSession(res, m) {
  setCookie(res, "pltc_s", sign({ uid: m.id, exp: Date.now() + SESSION_HOURS * 3600e3 }), SESSION_HOURS * 3600);
  setCookie(res, trustName(m.id), sign({ uid: m.id, exp: Date.now() + TRUST_DAYS * 86400e3 }), TRUST_DAYS * 86400);
  clearCookie(res, "pltc_p");
}
const pending = req => unsign(cookies(req).pltc_p);
const setPending = (res, p) => setCookie(res, "pltc_p", sign({ ...p, exp: Date.now() + 15 * 60e3 }), 15 * 60);

async function findMember(email) {
  const [m] = await sql`select * from members where email = ${email}`;
  if (m) return m;
  // Admin emails come from ADMIN_EMAILS in Vercel. If that isn't set, Alan (the owner) can still set the app up.
  const admins = (process.env.ADMIN_EMAILS || "alan@arenaclub.com").split(",").map(normEmail).filter(Boolean);
  if (!admins.includes(email)) return null;
  const name = email === "alan@arenaclub.com" ? "Alan Bailey" : email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const [created] = await sql`insert into members (name, email, role, dept) values (${name}, ${email}, 'admin', 'Managers')
    on conflict (email) do update set email = excluded.email returning *`;
  return created;
}
const channelsFor = m => [
  ...(m.phone ? [{ id: "sms", label: `Text ${maskPhone(m.phone)}` }, { id: "call", label: `Call ${maskPhone(m.phone)}` }] : []),
  { id: "email", label: `Email ${maskEmail(m.email)}` }
];

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return fail(res, 405, "Method not allowed");
  try {
    await ensureSchema();
    if (req.method === "GET") {
      // Public sign-in page settings (no account needed): is "Explore the demo" switched on by an admin?
      if (req.query && req.query.config) {
        const [d] = await sql`select value from settings where key = 'demo_on_login'`;
        return send(res, 200, { demo: d?.value === true });
      }
      const me = await currentUser(req);
      return me ? send(res, 200, { me }) : fail(res, 401, "Signed out");
    }
    const b = await body(req);

    switch (b.action) {
      case "lookup": {
        const email = normEmail(b.email);
        if (!emailOk(email)) return fail(res, 400, "Enter the email your lead added for you.");
        const m = await findMember(email);
        if (!m || !m.active) {
          const [{ n }] = await sql`select count(*)::int n from members where role = 'admin'`;
          return fail(res, 404, n ? "We don’t recognize that email. Ask your lead to add it to the roster."
            : "PL Time Cards isn’t set up yet. The first admin signs in with an email listed in ADMIN_EMAILS (Vercel › Settings › Environment Variables), then redeploys.");
        }
        clearCookie(res, "pltc_p");
        return send(res, 200, { name: m.name, email: m.email, hasPin: !!m.pin_hash, hasPhone: !!m.phone, channels: channelsFor(m) });
      }

      case "pin": {
        const m = await findMember(normEmail(b.email));
        if (!m || !m.active || !m.pin_hash) return fail(res, 400, "Start again with your email.");
        if (m.pin_lock_until && new Date(m.pin_lock_until) > new Date())
          return fail(res, 429, `Too many tries. Try again in ${Math.ceil((new Date(m.pin_lock_until) - Date.now()) / 60e3)} min.`);
        if (!pinMatches(String(b.pin || ""), m)) {
          const fails = m.pin_fails + 1;
          if (fails >= MAX_PIN_TRIES) {
            await sql`update members set pin_fails = 0, pin_lock_until = now() + make_interval(mins => ${LOCK_MIN}) where id = ${m.id}`;
            return fail(res, 429, `Too many tries. Try again in ${LOCK_MIN} min.`);
          }
          await sql`update members set pin_fails = ${fails} where id = ${m.id}`;
          return fail(res, 401, "That password isn’t right. Try again, or use Forgot password.");
        }
        await sql`update members set pin_fails = 0, pin_lock_until = null where id = ${m.id}`;
        startSession(res, m);
        return send(res, 200, { next: "done" });
      }

      case "forgotPin": {
        // Forgot password: prove it's you with a code (email / text / call), then pick a new password.
        const m = await findMember(normEmail(b.email));
        if (!m || !m.active) return fail(res, 400, "Start again with your email.");
        if (!m.pin_hash) return send(res, 200, { channels: channelsFor(m) });  // no password yet: the normal sign-up flow covers it
        setPending(res, { uid: m.id, stage: "reset" });
        return send(res, 200, { channels: channelsFor(m) });
      }

      case "sendCode": {
        const m = await findMember(normEmail(b.email));
        if (!m || !m.active) return fail(res, 400, "Start again with your email.");
        const p = pending(req);
        const mine = p && p.uid === m.id;
        const reset = !!(mine && (p.stage === "reset" || p.reset));
        const allowed = !m.pin_hash || (mine && (p.stage === "pin_ok" || p.stage === "code_sent" || p.stage === "reset"));
        if (!allowed) return fail(res, 403, "Enter your password first, or use Forgot password.");
        const ch = channelsFor(m).find(c => c.id === b.channel);
        if (!ch) return fail(res, 400, "Pick how you want to get your code.");
        const [{ n }] = await sql`select count(*)::int as n from codes where member_id = ${m.id} and created_at > now() - interval '1 hour'`;
        if (n >= MAX_SENDS_PER_HOUR) return fail(res, 429, "Too many codes requested. Wait an hour or ask your lead.");

        const own = ch.id === "email" || devCodes();
        const code = own ? sixDigits() : null;
        await sql`update codes set used = true where member_id = ${m.id} and used = false`;
        await sql`insert into codes (member_id, channel, code_hash, expires_at)
          values (${m.id}, ${ch.id}, ${own ? sha(`${m.id}:${code}`) : null}, now() + make_interval(mins => ${CODE_MIN}))`;
        if (devCodes()) { /* local testing: nothing is sent */ }
        else if (ch.id === "email") await sendEmailCode(m.email, m.name.split(" ")[0], code);
        else await twilioStart(m.phone, ch.id);

        setPending(res, { uid: m.id, stage: "code_sent", firstTime: !m.pin_hash, reset });
        const to = ch.id === "email" ? maskEmail(m.email) : maskPhone(m.phone);
        return send(res, 200, { channel: ch.id, sentTo: to, expiresMin: CODE_MIN, ...(devCodes() ? { devCode: code } : {}) });
      }

      case "verifyCode": {
        const p = pending(req);
        if (!p || p.stage !== "code_sent") return fail(res, 400, "Your sign-in timed out. Start again with your email.");
        const code = String(b.code || "").replace(/\D/g, "");
        if (code.length !== 6) return fail(res, 400, "Enter the 6 digit code.");
        const [row] = await sql`select * from codes where member_id = ${p.uid} and used = false order by id desc limit 1`;
        if (!row || new Date(row.expires_at) < new Date()) return fail(res, 400, "That code expired. Request a new code.");
        if (row.attempts >= MAX_CODE_TRIES) return fail(res, 429, "Too many tries on this code. Request a new code.");
        const [m] = await sql`select * from members where id = ${p.uid}`;
        if (!m || !m.active) return fail(res, 400, "Start again with your email.");
        const ok = row.code_hash ? row.code_hash === sha(`${m.id}:${code}`) : await twilioCheck(m.phone, code);
        if (!ok) {
          await sql`update codes set attempts = attempts + 1 where id = ${row.id}`;
          return fail(res, 401, "That code isn’t right. Check it and try again.");
        }
        await sql`update codes set used = true where id = ${row.id}`;
        if (m.pin_hash && !p.reset) { startSession(res, m); return send(res, 200, { next: "done" }); }
        setPending(res, { uid: m.id, stage: "verified", reset: !!p.reset });
        return send(res, 200, { next: "createPin" });
      }

      case "createPin": {
        const p = pending(req);
        if (!p || p.stage !== "verified") return fail(res, 400, "Your sign-in timed out. Start again with your email.");
        const pin = String(b.pin || "");   // the new password
        const [who] = await sql`select email from members where id = ${p.uid}`;
        const bad = pwProblem(pin, who?.email); if (bad) return fail(res, 400, bad);
        // Sign-up asks for a mobile number (used for texted sign-in codes). Not needed for a password reset or if one is already on file.
        let phone = null;
        if (!p.reset) {
          const [cur] = await sql`select phone from members where id = ${p.uid}`;
          if (!cur?.phone) {
            phone = normPhone(b.phone);
            if (!phone) return fail(res, 400, "Enter your mobile number.");
            if (!phoneOk(phone)) return fail(res, 400, "Enter your mobile number with country code, like +63 917 123 4567.");
          }
        }
        const salt = newSalt();
        const [m] = p.reset
          ? await sql`update members set pin_hash = ${hashPin(pin, salt)}, pin_salt = ${salt}, pin_fails = 0, pin_lock_until = null
              where id = ${p.uid} and active returning *`
          : await sql`update members set pin_hash = ${hashPin(pin, salt)}, pin_salt = ${salt}, pin_fails = 0, pin_lock_until = null,
              phone = coalesce(phone, ${phone})
              where id = ${p.uid} and pin_hash is null and active returning *`;
        if (!m) return fail(res, 409, "This account already has a password. Sign in with it, or use Forgot password.");
        startSession(res, m);
        return send(res, 200, { next: "done" });
      }

      case "changePin": {
        const me = await currentUser(req);
        if (!me) return fail(res, 401, "Signed out");
        const [m] = await sql`select * from members where id = ${me.id}`;
        if (m.pin_lock_until && new Date(m.pin_lock_until) > new Date()) return fail(res, 429, "Too many tries. Try again in a few minutes.");
        if (!pinMatches(String(b.current || ""), m)) {
          const fails = m.pin_fails + 1;
          if (fails >= MAX_PIN_TRIES) await sql`update members set pin_fails = 0, pin_lock_until = now() + make_interval(mins => ${LOCK_MIN}) where id = ${m.id}`;
          else await sql`update members set pin_fails = ${fails} where id = ${m.id}`;
          return fail(res, 401, "Your current password isn’t right.");
        }
        const pin = String(b.pin || "");
        const bad = pwProblem(pin, m.email); if (bad) return fail(res, 400, bad);
        const salt = newSalt();
        await sql`update members set pin_hash = ${hashPin(pin, salt)}, pin_salt = ${salt}, pin_fails = 0, pin_lock_until = null where id = ${m.id}`;
        return send(res, 200, { ok: true });
      }

      case "logout":
        clearCookie(res, "pltc_s"); clearCookie(res, "pltc_p");
        return send(res, 200, { ok: true });

      default: return fail(res, 400, "Unknown action");
    }
  } catch (e) {
    console.error(e);
    const setup = setupMessage(e);
    if (setup) return fail(res, 500, setup);
    const msg = /twilio_send|resend/.test(e.message) ? "Couldn’t send the code. Check the number or email on the roster, or try another method." : "Something went wrong. Try again.";
    return fail(res, 500, msg);
  }
}
