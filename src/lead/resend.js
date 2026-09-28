// Sends the ADF email through Resend's REST API. No SDK needed.
const API = 'https://api.resend.com/emails';

export async function sendAdfEmail({ to, subject, text, bcc, replyTo, tags }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;
  if (!key) return { ok: false, status: 'resend_not_configured', error: 'RESEND_API_KEY is not set' };
  if (!from) return { ok: false, status: 'resend_not_configured', error: 'LEAD_FROM_EMAIL is not set' };
  const body = { from, to: Array.isArray(to) ? to : [to], subject, text };
  if (bcc) body.bcc = Array.isArray(bcc) ? bcc : [bcc];
  if (replyTo) body.reply_to = replyTo;
  if (tags) body.tags = tags;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.RESEND_TIMEOUT_MS || 12000));
  try {
    const res = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: 'resend_rejected', http: res.status, error: data?.message || data?.name || `HTTP ${res.status}` };
    return { ok: true, status: 'sent', id: data.id };
  } catch (err) {
    return { ok: false, status: err.name === 'AbortError' ? 'resend_timeout' : 'resend_error', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
