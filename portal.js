(() => {
  "use strict";
  if (window.location.hostname === "wayman.attenorcollab.com") { window.location.replace("/"); return; }
  const content = document.querySelector("#portalContent");
  const requested = new URLSearchParams(window.location.search).get("next") || "/assessments";
  const destination = /^\/(?:assessments|facilitator|coherence(?:\/[a-z0-9][a-z0-9-]{0,79})?)$/.test(requested) ? requested : "/assessments";
  let pending = false;
  function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
  async function request(body) {
    let response;
    try { response = await fetch("/api/portal", { method: body ? "POST" : "GET", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error("We couldn’t reach the portal. Please try again."); }
    let result;
    try { result = await response.json(); } catch { throw new Error("The portal is temporarily unavailable. Please try again shortly."); }
    if (!response.ok) throw new Error(result.error || "Please check your password and try again.");
    return result;
  }
  function render(identity, message = "") {
    content.innerHTML = `${identity?.authenticated ? `<section class="portal-current-account"><span class="current-account-icon" aria-hidden="true">◎</span><div><p>Already signed in</p><strong>Facilitator</strong><div class="current-account-actions"><a href="${esc(destination)}">Continue to my workspace →</a><button type="button" id="signout">Sign out</button></div></div></section>` : ""}<div class="portal-form-heading facilitator-heading"><span class="portal-facilitator-symbol" aria-hidden="true">◎</span><p class="eyebrow">Private facilitator access</p><h2>A space for your team.</h2><p>Use your shared facilitator password to open your workspace and take the Leadership Coherence Check.</p></div><form id="portalForm"><div class="portal-field"><label for="password">Facilitator password</label><div class="portal-password-wrap"><input id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required><button class="portal-password-toggle" id="showPassword" type="button" aria-label="Show password" aria-pressed="false">Show</button></div></div><p class="portal-status" id="portalStatus" role="alert">${esc(message)}</p><button class="button portal-submit" type="submit">Open facilitator workspace →</button></form><p class="portal-form-footnote">No profile setup needed. Attenor will provide your shared password.</p>`;
    document.querySelector("#showPassword").addEventListener("click", (event) => {
      const input = document.querySelector("#password"); const show = input.type === "password";
      input.type = show ? "text" : "password"; event.currentTarget.textContent = show ? "Hide" : "Show";
      event.currentTarget.setAttribute("aria-label", `${show ? "Hide" : "Show"} password`); event.currentTarget.setAttribute("aria-pressed", String(show));
    });
    document.querySelector("#signout")?.addEventListener("click", () => perform(async () => { await request({ action: "logout" }); render(null); }));
    document.querySelector("#portalForm").addEventListener("submit", (event) => {
      event.preventDefault(); const password = document.querySelector("#password").value;
      perform(async () => { const result = await request({ action: "facilitator", password }); if (!result.authenticated || result.role !== "facilitator") throw new Error("Facilitator access could not be confirmed."); window.location.assign(destination); });
    });
  }
  async function perform(action) {
    if (pending) return; pending = true;
    const controls = [...content.querySelectorAll("input,button")]; const status = document.querySelector("#portalStatus");
    controls.forEach((control) => { control.disabled = true; }); status.textContent = "One moment…";
    try { await action(); } catch (error) { status.textContent = error.message; }
    finally { pending = false; controls.forEach((control) => { control.disabled = false; }); }
  }
  content.addEventListener("click", (event) => { if (pending) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  document.querySelector("#portalYear").textContent = new Date().getFullYear();
  (async () => {
    try { const result = await request(); if (result.waymanEntry) { window.location.replace("/wayman"); return; } render(result); }
    catch (error) { render(null, error.message); }
  })();
})();
