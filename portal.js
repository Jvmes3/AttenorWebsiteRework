(() => {
  "use strict";

  const content = document.querySelector("#portalContent");
  const animals = [
    { id: "fox", name: "Fox", emoji: "🦊" },
    { id: "owl", name: "Owl", emoji: "🦉" },
    { id: "bear", name: "Bear", emoji: "🐻" },
    { id: "rabbit", name: "Rabbit", emoji: "🐰" },
    { id: "panda", name: "Panda", emoji: "🐼" },
    { id: "cat", name: "Cat", emoji: "🐱" },
    { id: "dog", name: "Dog", emoji: "🐶" },
    { id: "tiger", name: "Tiger", emoji: "🐯" },
  ];
  const requestedPath = new URLSearchParams(window.location.search).get("next") || "/assessments";
  function destination(role) {
    if (role === "student") return /^\/benchmark-(?:[1-9]|1\d|2[0-2])$/.test(requestedPath) || requestedPath === "/profile" ? requestedPath : "/assessments";
    return /^\/(?:assessments|facilitator|coherence(?:\/[a-z0-9][a-z0-9-]{0,79})?|benchmark-(?:[1-9]|1\d|2[0-2]))$/.test(requestedPath) ? requestedPath : "/assessments";
  }
  let identity = null;
  let selectedRole = "student";
  let studentMode = "signin";
  let chosenAnimal = "fox";
  let studentCode = "";
  let teacherName = "";
  let pending = false;
  let initialMessage = "";

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  async function request(body) {
    let response;
    try {
      response = await fetch("/api/portal", {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error("We couldn’t reach the portal. Please check your connection and try again.");
    }
    let result;
    try { result = await response.json(); } catch { throw new Error("The portal is unavailable right now. Please try again shortly."); }
    if (!response.ok) throw new Error(result.error || "We couldn’t sign you in. Check your details and try again.");
    return result;
  }

  function preserveDetails() {
    studentCode = document.querySelector("#studentCode")?.value.trim() ?? studentCode;
    teacherName = document.querySelector("#teacherName")?.value.trim() ?? teacherName;
  }

  function signedInCard() {
    if (!identity?.authenticated) return "";
    const student = identity.role === "student";
    const animal = animals.find((item) => item.id === identity.profile?.avatar) || animals[0];
    return `<section class="portal-current-account" aria-label="Current portal account"><span class="current-account-icon" aria-hidden="true">${student ? animal.emoji : "◎"}</span><div><p>Already signed in</p><strong>${student ? escape(identity.profile?.studentCode || "Student") : "Facilitator"}</strong><div class="current-account-actions"><a href="/assessments">Continue to my portal <span aria-hidden="true">→</span></a><button id="switchAccount" type="button">Use a different account</button></div></div></section>`;
  }

  function passwordField(label, id = "password", confirmation = false) {
    return `<div class="portal-field"><label for="${id}">${label}</label><div class="portal-password-wrap"><input id="${id}" name="${id}" type="password" autocomplete="${selectedRole === "student" && studentMode === "signup" ? "new-password" : "current-password"}" ${selectedRole === "student" ? 'minlength="8" maxlength="128"' : 'maxlength="200"'} required><button type="button" class="portal-password-toggle" data-toggle="${id}" aria-label="Show ${confirmation ? "confirmed password" : "password"}" aria-pressed="false">Show</button></div>${!confirmation && selectedRole === "student" && studentMode === "signup" ? '<p class="portal-field-helper">Use 8–128 characters. Choose a password you can remember.</p>' : ""}</div>`;
  }

  function studentFields() {
    const signup = studentMode === "signup";
    return `<div class="portal-student-switch" aria-label="Student access options"><button type="button" data-student-mode="signin" aria-pressed="${!signup}">Sign in</button><button type="button" data-student-mode="signup" aria-pressed="${signup}">Create an account</button></div><div class="portal-form-heading"><h2>${signup ? "Let’s make this your space." : "Welcome back, curious mind."}</h2><p>${signup ? "Choose a friend for your avatar, then add your details." : "Enter your student code and password to see your available benchmarks."}</p></div><form id="portalForm">${signup ? `<fieldset class="portal-avatar-fieldset"><legend>Choose your animal avatar</legend><div class="portal-avatar-options">${animals.map((animal) => `<label class="portal-avatar-option"><input type="radio" name="animal" value="${animal.id}" ${chosenAnimal === animal.id ? "checked" : ""} required><span class="portal-avatar-tile"><span aria-hidden="true">${animal.emoji}</span><small>${animal.name}</small></span></label>`).join("")}</div></fieldset>` : ""}<div class="portal-field"><label for="studentCode">Student code</label><input id="studentCode" name="studentCode" value="${escape(studentCode)}" placeholder="e.g. W5-001" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,79}" minlength="2" maxlength="80" autocomplete="username" autocapitalize="characters" spellcheck="false" required><p class="portal-field-helper">Use the code your teacher gave you. You don’t need to enter your full name.</p></div>${signup ? `<div class="portal-field"><label for="teacherName">Teacher’s name</label><input id="teacherName" name="teacherName" value="${escape(teacherName)}" placeholder="e.g. Ms. Rivera" maxlength="120" autocomplete="off" required></div>` : ""}${passwordField("Password")}${signup ? passwordField("Confirm password", "confirmPassword", true) : ""}<p class="portal-status" id="portalStatus" role="alert">${escape(initialMessage)}</p><button class="button portal-submit" type="submit">${signup ? "Create student account" : "Sign in"}<span aria-hidden="true">→</span></button></form><p class="portal-form-footnote">${signup ? "You can change your animal avatar in your profile later." : "New here? Choose “Create an account” to get started."}</p>`;
  }

  function facilitatorFields() {
    return `<div class="portal-form-heading facilitator-heading"><span class="portal-facilitator-symbol" aria-hidden="true">◎</span><p class="eyebrow">Shared facilitator access</p><h2>A space for your team.</h2><p>Use your shared facilitator password to open your workspace, manage sessions, and take the Leadership Coherence Check.</p></div><form id="portalForm">${passwordField("Facilitator password")}<p class="portal-status" id="portalStatus" role="alert">${escape(initialMessage)}</p><button class="button portal-submit" type="submit">Open facilitator portal<span aria-hidden="true">→</span></button></form><p class="portal-form-footnote">No profile setup needed. Attenor will provide your shared password.</p>`;
  }

  function render() {
    content.innerHTML = `${signedInCard()}<fieldset class="portal-role-fieldset"><legend>How are you joining us?</legend><div class="portal-role-options"><label class="portal-role-option"><input type="radio" name="portalRole" value="student" ${selectedRole === "student" ? "checked" : ""}><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 9-4 9 4-9 4-9-4Z M6 9v7c4 3 8 3 12 0V9 M21 7v9"/></svg>Student</span></label><label class="portal-role-option"><input type="radio" name="portalRole" value="facilitator" ${selectedRole === "facilitator" ? "checked" : ""}><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3 M16 4a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 5"/></svg>Facilitator</span></label></div></fieldset>${selectedRole === "student" ? studentFields() : facilitatorFields()}`;
    initialMessage = "";
    bind();
  }

  function bind() {
    document.querySelectorAll('input[name="portalRole"]').forEach((input) => input.addEventListener("change", () => {
      preserveDetails();
      selectedRole = input.value;
      render();
      document.querySelector(`input[name="portalRole"][value="${selectedRole}"]`).focus();
    }));
    document.querySelectorAll("[data-student-mode]").forEach((button) => button.addEventListener("click", () => {
      preserveDetails();
      studentMode = button.dataset.studentMode;
      render();
      document.querySelector(`[data-student-mode="${studentMode}"]`).focus();
    }));
    document.querySelectorAll('input[name="animal"]').forEach((input) => input.addEventListener("change", () => { chosenAnimal = input.value; }));
    document.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.toggle);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "Hide" : "Show";
      button.setAttribute("aria-pressed", String(show));
      button.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${button.dataset.toggle === "confirmPassword" ? "confirmed password" : "password"}`);
    }));
    document.querySelector("#switchAccount")?.addEventListener("click", async () => {
      await perform(async () => {
        await request({ action: "logout" });
        identity = null;
        render();
      });
    });
    document.querySelector("#portalForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = document.querySelector("#password").value;
      const status = document.querySelector("#portalStatus");
      const confirmation = document.querySelector("#confirmPassword");
      if (confirmation && confirmation.value !== password) {
        status.textContent = "Your passwords don’t match yet. Enter the same password in both fields.";
        confirmation.setAttribute("aria-invalid", "true");
        confirmation.focus();
        return;
      }
      confirmation?.removeAttribute("aria-invalid");
      preserveDetails();
      if (selectedRole === "student" && studentMode === "signup" && !teacherName) {
        status.textContent = "Please enter your teacher’s name.";
        document.querySelector("#teacherName").focus();
        return;
      }
      const body = selectedRole === "facilitator" ? { action: "facilitator", password } : { action: studentMode, studentCode, password, ...(studentMode === "signup" ? { teacherName, avatar: chosenAnimal } : {}) };
      await perform(async () => {
        const result = await request(body);
        if (!result.authenticated || result.role !== selectedRole) throw new Error("We couldn’t confirm your portal access. Please try signing in again.");
        status.textContent = "You’re signed in. Opening your portal…";
        window.location.assign(destination(result.role));
      });
    });
  }

  async function perform(action) {
    if (pending) return;
    const controls = [...content.querySelectorAll("input:not(:disabled), button:not(:disabled)")];
    const status = document.querySelector("#portalStatus");
    controls.forEach((control) => { control.disabled = true; });
    pending = true;
    status.textContent = "One moment…";
    try { await action(); }
    catch (error) { status.textContent = error.message; }
    finally { pending = false; controls.forEach((control) => { control.disabled = false; }); }
  }

  content.addEventListener("click", (event) => {
    if (pending) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.querySelector("#portalYear").textContent = new Date().getFullYear();
  (async () => {
    try {
      const result = await request();
      identity = result.authenticated ? result : null;
    } catch (error) { initialMessage = error.message; }
    render();
  })();
})();
