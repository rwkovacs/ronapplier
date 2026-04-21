const serverStatus = document.getElementById("server-status");
const statusEl = document.getElementById("status");
const fillBtn = document.getElementById("fill");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

chrome.runtime.sendMessage({ type: "ping" }, (res) => {
  if (chrome.runtime.lastError || !res || !res.ok) {
    serverStatus.textContent =
      "Server offline. Run `npm start` in ronapplier.";
    serverStatus.className = "sub err";
    fillBtn.disabled = true;
    return;
  }
  const profile = res.profile || {};
  const who = profile.preferredName || profile.firstName || "profile";
  serverStatus.textContent = `Connected · signed in as ${who}`;
  serverStatus.className = "sub ok";
});

fillBtn.addEventListener("click", async () => {
  fillBtn.disabled = true;
  setStatus("Triggering autofill…", "");
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab || !tab.id) throw new Error("no active tab");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const btn = document.getElementById("__ronapplier_btn");
        if (btn) btn.click();
      },
    });
    setStatus("Triggered. Watch the page.", "ok");
    setTimeout(() => window.close(), 800);
  } catch (err) {
    setStatus("Failed: " + err.message, "err");
    fillBtn.disabled = false;
  }
});
