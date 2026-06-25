// OcoaBay scheduled jobs — calls the Pages cron endpoints on a schedule with the ADMIN_TOKEN.
// Activate by setting the ADMIN_TOKEN secret:  wrangler secret put ADMIN_TOKEN
// (No-op until then, so deploying early is safe.)
export default {
  async scheduled(event, env, ctx) {
    if (!env.ADMIN_TOKEN) return; // not activated yet — do nothing
    const base = (env.TARGET_BASE || "").replace(/\/$/, "");
    const hit = (path) =>
      fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } })
        .then((r) => r.text()).catch(() => {});

    const c = event.cron;
    const jobs = [];
    if (c === "*/15 * * * *") jobs.push(hit("/api/cron/holds-sweeper"), hit("/api/cron/attendance-replay"));
    else if (c === "*/30 * * * *") jobs.push(hit("/api/cron/cs-digest"));
    else if (c === "0 * * * *") jobs.push(hit("/api/cron/reminders"), hit("/api/cron/abandoned"), hit("/api/cron/odoo-sync"));
    else if (c === "30 6 * * *") jobs.push(hit("/api/cron/generate-slots"), hit("/api/cron/fx-update"));
    else if (c === "0 11 * * *") jobs.push(hit("/api/cron/balance-due"));

    ctx.waitUntil(Promise.all(jobs));
  },
};
