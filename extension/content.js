(() => {
  if (window.__ronapplier_loaded) return;
  window.__ronapplier_loaded = true;

  injectButton();

  function injectButton() {
    if (document.getElementById("__ronapplier_btn")) return;
    const btn = document.createElement("button");
    btn.id = "__ronapplier_btn";
    btn.type = "button";
    btn.textContent = "⚡ Autofill";
    btn.style.cssText = [
      "position:fixed",
      "bottom:20px",
      "right:20px",
      "z-index:2147483647",
      "background:#4a9eff",
      "color:#04121f",
      "border:0",
      "padding:10px 16px",
      "border-radius:8px",
      "font-weight:600",
      "font-size:14px",
      "cursor:pointer",
      "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
      "font-family:-apple-system, BlinkMacSystemFont, sans-serif",
    ].join(";");
    btn.addEventListener("click", onClick);
    (document.body || document.documentElement).appendChild(btn);
  }

  async function onClick() {
    const btn = document.getElementById("__ronapplier_btn");
    if (!btn || btn.disabled) return;
    const original = btn.textContent;
    btn.disabled = true;
    try {
      btn.textContent = "Reading form…";
      const fields = extractFormFields();
      if (!fields.length) {
        flash(btn, "No form found", original);
        return;
      }

      btn.textContent = "Uploading resume…";
      await tryResumeUpload();

      btn.textContent = `Asking Claude (${fields.length} fields)…`;
      const result = await sendMessage({ type: "autofill", fields });
      if (!result.ok) throw new Error(result.error || "autofill failed");

      btn.textContent = "Filling…";
      let filled = 0;
      for (const item of result.fills || []) {
        try {
          if (applyValue(item)) filled++;
        } catch {}
      }
      flash(btn, `✓ ${filled}/${fields.length}`, original);
    } catch (err) {
      flash(btn, "Error: " + String(err.message || err).slice(0, 40), original);
    }
  }

  function flash(btn, msg, original) {
    btn.textContent = msg;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 3500);
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: "no response" });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  async function tryResumeUpload() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const candidates = inputs.filter((input) => {
      const hay =
        (input.name || "") +
        " " +
        (input.id || "") +
        " " +
        (input.accept || "") +
        " " +
        (labelFor(input) || "");
      return (
        /resume|cv|curriculum/i.test(hay) ||
        /application\/pdf|\.pdf/i.test(input.accept || "")
      );
    });
    if (!candidates.length) return 0;

    const res = await sendMessage({ type: "resume" });
    if (!res.ok) return 0;

    const bin = atob(res.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const file = new File([blob], "resume.pdf", { type: "application/pdf" });

    let uploaded = 0;
    for (const input of candidates) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        uploaded++;
      } catch {}
    }
    return uploaded;
  }

  function labelFor(el) {
    if (el.labels && el.labels.length) {
      return Array.from(el.labels)
        .map((l) => l.innerText.trim())
        .filter(Boolean)
        .join(" ");
    }
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const aby = el.getAttribute("aria-labelledby");
    if (aby) {
      return aby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText?.trim())
        .filter(Boolean)
        .join(" ");
    }
    if (el.placeholder) return el.placeholder;
    const wrap = el.closest("label");
    if (wrap) return wrap.innerText.trim();
    return "";
  }

  function extractFormFields() {
    const out = [];
    const controls = document.querySelectorAll("input, select, textarea");
    let idx = 0;
    for (const el of controls) {
      if (el.disabled) continue;
      if (el.type === "hidden") continue;
      if (el.type === "submit" || el.type === "button" || el.type === "reset")
        continue;
      if (el.type === "file") continue;
      if (!el.offsetParent && el.type !== "radio" && el.type !== "checkbox")
        continue;

      const afId = `__af_${idx++}`;
      el.setAttribute("data-af-id", afId);

      const entry = {
        afId,
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        name: el.name || "",
        id: el.id || "",
        label: labelFor(el),
        required: !!(el.required || el.getAttribute("aria-required") === "true"),
      };

      if (el.tagName === "SELECT") {
        entry.options = Array.from(el.options).map((o) => ({
          value: o.value,
          text: o.text,
        }));
      }

      if (el.type === "radio" || el.type === "checkbox") {
        const group = el.name || "";
        const groupKey = `${el.type}:${group}`;
        const existing = out.find((x) => x.groupKey === groupKey);
        if (existing) {
          existing.options.push({ afId, value: el.value, text: labelFor(el) });
          continue;
        }
        entry.groupKey = groupKey;
        entry.options = [{ afId, value: el.value, text: labelFor(el) }];
        entry.label = entry.label || group;
      }

      out.push(entry);
    }
    return out;
  }

  function applyValue(item) {
    const el = document.querySelector(`[data-af-id="${item.afId}"]`);
    if (!el) {
      const target = findGroupTarget(item);
      if (!target) return false;
      return check(target);
    }

    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      return selectOption(el, item.value);
    }
    if (el.type === "radio" || el.type === "checkbox") {
      return findGroupTarget(item) ? check(findGroupTarget(item)) : false;
    }

    return setText(el, String(item.value));
  }

  function findGroupTarget(item) {
    const allInGroup = document.querySelectorAll(
      `[data-af-id^="__af_"]`,
    );
    const v = String(item.value).toLowerCase().trim();
    let best = null;
    for (const el of allInGroup) {
      if (el.type !== "radio" && el.type !== "checkbox") continue;
      const label = (labelFor(el) || "").toLowerCase();
      const val = (el.value || "").toLowerCase();
      if (val === v || label === v) return el;
      if (!best && (val.includes(v) || label.includes(v))) best = el;
    }
    return best;
  }

  function selectOption(el, value) {
    const v = String(value).toLowerCase().trim();
    let match = null;
    for (const o of el.options) {
      if ((o.value || "").toLowerCase() === v) {
        match = o;
        break;
      }
      if ((o.text || "").toLowerCase() === v) {
        match = o;
        break;
      }
      if (!match && (o.text || "").toLowerCase().includes(v)) match = o;
    }
    if (!match) return false;
    el.value = match.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function check(el) {
    el.checked = true;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("click", { bubbles: true }));
    return true;
  }

  function setText(el, value) {
    // React/Vue controlled inputs: use the native setter so framework
    // state tracks the change.
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
})();
