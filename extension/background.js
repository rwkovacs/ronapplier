const SERVER = "http://localhost:3000";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "autofill") {
    fetch(`${SERVER}/api/autofill-fields`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: msg.fields, jobContext: msg.jobContext || null }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        sendResponse({ ok: true, fills: data.fills || [] });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg && msg.type === "resume") {
    fetch(`${SERVER}/api/resume.pdf`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        sendResponse({ ok: true, base64: btoa(binary) });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg && msg.type === "ping") {
    fetch(`${SERVER}/api/profile`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
