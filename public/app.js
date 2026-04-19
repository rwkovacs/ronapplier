(() => {
  const form = document.getElementById("draft-form");
  const statusEl = document.getElementById("status");
  const output = document.getElementById("output");
  const coverEl = document.getElementById("cover-letter");
  const emailEl = document.getElementById("outreach-email");
  const draftBtn = document.getElementById("draft-btn");
  const logBtn = document.getElementById("log-btn");
  const appList = document.getElementById("app-list");

  let lastDraft = null;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    setStatus("Drafting… this can take 20–40 seconds.", "");
    draftBtn.disabled = true;
    logBtn.disabled = true;
    output.hidden = true;

    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);

      coverEl.textContent = payload.coverLetter || "(empty)";
      emailEl.textContent = payload.outreachEmail || "(empty)";
      output.hidden = false;
      lastDraft = { ...data };
      logBtn.disabled = false;
      setStatus("Draft ready. Review before sending.", "ok");
    } catch (err) {
      setStatus("Draft failed: " + err.message, "err");
    } finally {
      draftBtn.disabled = false;
    }
  });

  logBtn.addEventListener("click", async () => {
    if (!lastDraft) return;
    logBtn.disabled = true;
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: lastDraft.company,
          role: lastDraft.role,
          jobUrl: lastDraft.jobUrl || null,
          hiringManager: lastDraft.hiringManager || null,
          notes: lastDraft.extraContext || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      setStatus("Logged.", "ok");
      await loadApplications();
    } catch (err) {
      setStatus("Log failed: " + err.message, "err");
      logBtn.disabled = false;
    }
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    const el = document.getElementById(btn.dataset.copy);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(
      () => {
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = prev), 1200);
      },
      () => setStatus("Copy failed", "err"),
    );
  });

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  async function loadApplications() {
    try {
      const apps = await fetch("/api/applications").then((r) => r.json());
      if (!apps.length) {
        appList.innerHTML = '<p class="status">No applications logged yet.</p>';
        return;
      }
      appList.innerHTML = apps
        .map(
          (a) => `
          <div class="app-item">
            <div>
              <div><strong>${escapeHtml(a.company)}</strong> — ${escapeHtml(a.role)}</div>
              <div class="app-meta">
                ${a.hiringManager ? "Manager: " + escapeHtml(a.hiringManager) + " · " : ""}
                ${a.jobUrl ? `<a href="${escapeAttr(a.jobUrl)}" target="_blank" rel="noopener">Posting</a> · ` : ""}
                ${escapeHtml(new Date(a.createdAt).toLocaleString())}
              </div>
            </div>
            <div class="app-meta">${escapeHtml(a.status)}</div>
          </div>`,
        )
        .join("");
    } catch {
      appList.innerHTML = '<p class="status err">Could not load applications.</p>';
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  loadApplications();
})();
