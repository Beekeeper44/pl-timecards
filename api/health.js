import { sql, ensureSchema, setupMessage, MB_HOST } from "./_lib.js";

// Open /api/health in a browser to see what the deployment is missing. Shows no secrets.
export default async function handler(req, res) {
  const out = {
    database: "not checked",
    sessionSecret: !!process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32,
    adminEmails: (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean).length,
    textAndCallCodes: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SID),
    emailCodes: !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
    metabaseEmbedding: !!(MB_HOST() && process.env.METABASE_SECRET_KEY),
    metabaseCardCounts: !!(MB_HOST() && process.env.METABASE_API_KEY),
    testCodesOnScreen: process.env.DEV_SHOW_CODES === "1" && process.env.VERCEL_ENV !== "production"
  };
  try { await ensureSchema(); await sql`select 1`; out.database = "ok"; }
  catch (e) { out.database = setupMessage(e) || "error: " + String(e.message).slice(0, 160); }
  const ok = out.database === "ok" && out.sessionSecret && out.adminEmails > 0 && (out.emailCodes || out.testCodesOnScreen);
  res.status(ok ? 200 : 500).json({ ok, ...out });
}
