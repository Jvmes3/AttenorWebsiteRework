(() => {
  "use strict";

  const main = document.querySelector("#main");
  const breadcrumb = document.querySelector("#breadcrumb");
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const dimensions = [
    { name: "Strategic Clarity", description: "Our team shares a clear understanding of our priorities, the outcomes we are working toward, and why they matter.", prompt: "What tells you that the strategy is clear—or that it needs more clarity?" },
    { name: "Leadership Alignment", description: "Our leaders share ownership of the strategy and reinforce consistent priorities through their decisions and actions.", prompt: "Where do you see leaders working in alignment? Where do perspectives or actions differ?" },
    { name: "Enabling Conditions", description: "Our structures, resources, time, and working environment support the work we are asking people to do.", prompt: "Which conditions help the strategy succeed? Which conditions get in the way?" },
    { name: "Capacity Building", description: "Our team has the knowledge, skills, and ongoing support needed to translate priorities into effective practice.", prompt: "What capabilities are in place, and where is additional learning or support needed?" },
    { name: "Data Use", description: "Our team uses relevant evidence to understand progress, learn together, and adjust decisions.", prompt: "How does evidence shape your team's conversations and next steps?" },
    { name: "Community Engagement", description: "Students, families, staff, and community partners have meaningful opportunities to inform and contribute to our work.", prompt: "Whose perspectives are shaping the work? Whose voices need more space?" },
    { name: "Accountability Systems", description: "Responsibilities, expectations, and ways of reviewing progress are clear and support shared follow-through.", prompt: "How do you know who owns the work and whether commitments are being met?" },
    { name: "Foresight Readiness", description: "Our team considers emerging changes and prepares for the future while making decisions today.", prompt: "What signals or future possibilities are informing your team's planning?" },
  ];
  const anchors = ["Not yet in place", "Emerging", "Developing", "Established", "Consistent"];
  const icons = {
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    book: '<path d="m3 7 9-4 9 4-9 4-9-4Z M6 9v7c4 3 8 3 12 0V9 M21 7v9"/>',
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3 M16 4a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    chart: '<path d="M4 20V10 M10 20V4 M16 20v-8 M22 20H2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    link: '<path d="m9 15 6-6 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)"/>',
  };
  const animals = { fox: "🦊", owl: "🦉", bear: "🐻", rabbit: "🐰", panda: "🐼", cat: "🐱", dog: "🐶", tiger: "🐯" };
  let portalIdentity = null;
  let catalog = [];
  let session = null;
  let mode = "preview";
  let storageMode = "memory";
  let authorized = false;
  let ratings = dimensions.map(() => ({ score: null, explanation: "" }));
  let step = 0;
  let submissionId = crypto.randomUUID();
  let questions = [];
  let answers = {};
  let studentCode = "";
  let teacherName = "";
  let adminSessions = [];
  let adminTab = "sessions";
  let selectedSlug = "";
  let adminTimer = null;
  let pollBusy = false;
  let submitting = false;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }
  function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.target}</svg>`; }
  function routeFor(item) { return item.type === "benchmark" && item.slug === `benchmark-${item.benchmark}` ? `/benchmark-${item.benchmark}` : `/coherence/${encodeURIComponent(item.slug)}`; }
  function fullUrl(item) { return `${window.location.origin}${routeFor(item)}`; }
  function setView(content, title, nav) {
    main.innerHTML = content;
    breadcrumb.textContent = title;
    document.title = `${title} | Attenor Collaborative`;
    document.querySelectorAll("[data-nav]").forEach((link) => {
      const active = link.dataset.nav === nav;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
  }
  function focusMain() { main.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); }
  async function api(endpoint, body) {
    let response;
    try {
      response = await fetch(`/api/assessment-${endpoint}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error("We couldn't reach the assessment service. Keep this page open and try again.");
    }
    let result;
    try { result = await response.json(); } catch { throw new Error("The assessment service is unavailable. Please try again shortly."); }
    if (!response.ok) {
      const error = new Error(result.error || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    if (result.storage) storageMode = result.storage;
    return result;
  }
  function notice() {
    if (mode === "preview" && storageMode !== "database") return '<div class="notice"><strong>Design preview</strong> · Responses are held only for this preview and clear when the server restarts. Use practice responses.</div>';
    return mode === "preview" || portalIdentity?.mode === "preview" ? '<div class="notice"><strong>Test portal</strong> · Practice accounts and responses are saved separately from live sessions.</div>' : "";
  }
  function passwordField(label = "Session password") {
    return `<div class="field"><label for="password">${label}</label><div class="password-wrap"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" maxlength="200" required><button type="button" id="togglePassword" aria-label="Show password">Show</button></div></div>`;
  }
  function bindPassword() {
    document.querySelector("#togglePassword")?.addEventListener("click", (event) => {
      const input = document.querySelector("#password");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      event.currentTarget.textContent = show ? "Hide" : "Show";
      event.currentTarget.setAttribute("aria-label", `${show ? "Hide" : "Show"} password`);
    });
  }
  function fail(message, title = "This session needs a quick check.") {
    setView(`<a class="back-link" href="/assessments">← Back to overview</a><section class="error-card"><p class="eyebrow">Assessment access</p><h1>${esc(title)}</h1><p role="status">${esc(message)}</p><a class="button" href="/assessments">Return to the studio <span aria-hidden="true">→</span></a></section>`, "Session access", "assessments");
  }

  async function portalRequest(body) {
    let response;
    try {
      response = await fetch("/api/portal", { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(20000) });
    } catch { throw new Error("We couldn't reach the portal. Please try again."); }
    let result;
    try { result = await response.json(); } catch { throw new Error("The portal is temporarily unavailable. Please try again shortly."); }
    if (!response.ok) { const error = new Error(result.error || "Please check your details and try again."); error.status = response.status; throw error; }
    return result;
  }

  function updatePortalShell() {
    const student = portalIdentity.role === "student";
    document.body.classList.toggle("student-portal", student);
    document.querySelectorAll("[data-facilitator-only]").forEach((item) => { item.hidden = student; });
    document.querySelectorAll("[data-student-only]").forEach((item) => { item.hidden = !student; });
    document.querySelector("#portalRole").textContent = student ? "Student portal" : "Facilitator portal";
    const avatar = document.querySelector("#portalAvatar");
    avatar.hidden = !student;
    avatar.textContent = student ? animals[portalIdentity.profile.avatar] : "AC";
    const signout = document.querySelector("#portalSignout");
    signout.hidden = false;
    signout.onclick = async () => {
      signout.disabled = true;
      try { await portalRequest({ action: "logout" }); window.location.assign("/portal"); }
      catch (error) { signout.disabled = false; const status = document.querySelector("#portalStatus") || main.appendChild(document.createElement("p")); status.id = "portalStatus"; status.className = "status-message"; status.setAttribute("role", "status"); status.textContent = error.message; }
    };
  }

  async function bootstrap() {
    try {
      portalIdentity = await portalRequest();
      if (!portalIdentity.authenticated) { window.location.replace(`/portal?next=${encodeURIComponent(path)}`); return; }
      updatePortalShell();
      if (portalIdentity.role === "student" && (path === "/facilitator" || path === "/coherence")) { window.location.replace("/assessments"); return; }
      const result = await api("session?catalog=1");
      catalog = result.sessions || [];
      mode = result.mode;
      const leadershipSession = catalog.find((item) => item.type === "leadership" && item.status === "open");
      if (leadershipSession) document.querySelector('[data-nav="leadership"]').href = routeFor(leadershipSession);
      if (path === "/profile") return portalIdentity.role === "student" ? renderProfile() : window.location.replace("/assessments");
      if (path === "/facilitator") return openAdmin();
      if (path === "/coherence") return renderCodeEntry();
      if (path.startsWith("/coherence/")) {
        const slug = path.slice("/coherence/".length);
        return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) ? openSession(slug) : fail("Please use the complete link from your facilitator.");
      }
      if (/^\/benchmark-(?:[1-9]|1\d|2[0-2])$/.test(path)) return path === "/benchmark-1" ? openSession("benchmark-1") : renderComingSoon();
      renderHub();
    } catch (error) {
      if (error.status === 401 || error.status === 403) { window.location.replace("/portal"); return; }
      fail(error.message, "We couldn’t open your portal yet.");
    }
  }

  function renderStudentHub() {
    const profile = portalIdentity.profile;
    const available = catalog.filter((item) => item.type === "benchmark" && item.status === "open");
    setView(`${notice()}<div class="page-heading"><div><p class="eyebrow">Wayman Academy of Arts · Grade 5</p><h1>Hello, ${esc(profile.studentCode)}.</h1><p>Bring your curiosity. There’s something new to learn.</p></div><a class="student-welcome-avatar" href="/profile" aria-label="View my profile">${animals[profile.avatar]}</a></div><section class="hero-panel student-hero"><div class="hero-copy"><p class="eyebrow">Your learning journey</p><h2>Small steps.<br><em>Growing minds.</em></h2><p>A little thinking. A little exploring. Every benchmark helps you and your teacher see how far you’ve come.</p></div><div class="student-hero-art" aria-hidden="true"><span>✦</span><div>${animals[profile.avatar]}</div><small>ONE STEP AT A TIME</small></div></section><section class="benchmarks-section"><div class="section-label"><h2>Ready when you are</h2><span>${available.length} ${available.length === 1 ? "benchmark" : "benchmarks"} available</span></div><div class="benchmark-list">${available.length ? available.map((item) => `<article class="benchmark-row"><span class="week-number">${String(item.benchmark).padStart(2, "0")}</span><div><h3>${esc(item.name)}</h3><p>Week ${item.benchmark} · Grade 5 science · Work at your own pace</p></div><span class="pill">Available</span><a class="button small" href="${esc(routeFor(item))}">Start benchmark <span aria-hidden="true">→</span></a></article>`).join("") : '<div class="empty-state">You’re all caught up for now. Your teacher will let you know when your next benchmark opens.</div>'}</div></section><div class="student-profile-strip"><span class="profile-strip-animal" aria-hidden="true">${animals[profile.avatar]}</span><div><strong>Your space, your little companion.</strong><p>Student code: ${esc(profile.studentCode)} · Teacher: ${esc(profile.teacherName)}</p></div><a class="text-link" href="/profile">View my profile →</a></div>`, "My benchmarks", "assessments");
  }

  function renderProfile(message = "") {
    const profile = portalIdentity.profile;
    setView(`${notice()}<a class="back-link" href="/assessments">← Back to my benchmarks</a><div class="page-heading"><div><p class="eyebrow">A little space of your own</p><h1>My profile.</h1><p>Your student details and your animal companion.</p></div></div><section class="profile-layout"><div class="profile-summary"><span class="profile-large-animal" aria-hidden="true">${animals[profile.avatar]}</span><h2>${esc(profile.studentCode)}</h2><span class="pill">Wayman student</span><dl><dt>STUDENT CODE</dt><dd>${esc(profile.studentCode)}</dd><dt>TEACHER</dt><dd>${esc(profile.teacherName)}</dd><dt>PASSWORD</dt><dd>••••••••</dd></dl><p>Your password stays private. Your teacher can help if your student details need to change.</p></div><form id="avatarForm" class="profile-avatar-panel"><p class="eyebrow">Pick your learning companion</p><h2>A new animal. Still you.</h2><p>Choose a favorite. You can change it whenever you like.</p><fieldset class="animal-fieldset"><legend class="sr-only">Choose your animal avatar</legend><div class="profile-animal-grid">${Object.entries(animals).map(([name, emoji]) => `<label class="profile-animal-option"><input type="radio" name="avatar" value="${name}" ${profile.avatar === name ? "checked" : ""} required><span><strong aria-hidden="true">${emoji}</strong><small>${name.charAt(0).toUpperCase() + name.slice(1)}</small></span></label>`).join("")}</div></fieldset><p class="status-message ${message ? "profile-saved" : ""}" id="profileStatus" role="status">${esc(message)}</p><button class="button" type="submit">Save my avatar <span aria-hidden="true">→</span></button></form></section>`, "My profile", "profile");
    document.querySelector("#avatarForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      const status = document.querySelector("#profileStatus");
      status.textContent = "Saving your companion…";
      try {
        const result = await portalRequest({ action: "profile", avatar: new FormData(event.currentTarget).get("avatar") });
        if (result.profile) portalIdentity.profile = result.profile;
        else portalIdentity = await portalRequest();
        updatePortalShell();
        renderProfile("Your avatar is saved. Looking good!");
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  }

  function renderHub() {
    if (portalIdentity?.role === "student") return renderStudentHub();
    setView(`<div class="page-heading"><div><p class="eyebrow">A little reflection. A clearer path forward.</p><h1>Welcome to the studio.</h1><p>A shared space to pause, understand, and move forward together.</p></div><span class="date-stamp">ATTENOR COLLABORATIVE</span></div>
      <section class="hero-panel" aria-labelledby="heroTitle"><div class="hero-copy"><p class="eyebrow">Perspective is where progress begins</p><h2 id="heroTitle">Individual voices.<br><em>Shared understanding.</em></h2><p>Bring your perspective to the bigger picture. Our assessments help teams and learners see where they are—and what comes next.</p></div><div class="hero-illustration" aria-hidden="true"><div class="orbit"></div><div class="orbit"></div><div class="orbit"></div><div class="orbit-center">ac</div><span class="orbit-dot"></span><span class="orbit-dot second"></span><span class="orbit-cross">+</span></div></section>
      <div class="facilitator-prompt"><span class="tool-icon">${icon("target")}</span><div><p class="eyebrow">Start with your perspective</p><h2>Your team’s clarity starts with you.</h2><p>Complete the Leadership Coherence Check before reviewing your team’s results.</p></div><a class="button" href="${esc(routeFor(catalog.find((item) => item.type === "leadership" && item.status === "open") || {type: "leadership", slug: "leadership-demo"}))}">Complete my reflection <span aria-hidden="true">→</span></a></div><div class="section-label"><h2>Find your starting point</h2><span>Two pathways. One purpose: progress.</span></div>
      <div class="tool-grid"><article class="tool-card" id="leadership"><div class="tool-card-top"><span class="tool-icon">${icon("target")}</span><span class="pill">For leadership teams</span></div><p class="eyebrow">Reflect · Align · Lead</p><h3>Leadership Coherence Check</h3><p>Explore how your team sees its strategy, capacity, and readiness for what’s next. Eight dimensions to start a more meaningful conversation.</p><div class="tool-meta"><span>${icon("target")}8 dimensions</span><span>${icon("people")}5–15 participants</span><span>${icon("lock")}Password access</span></div><div class="tool-card-footer"><a class="text-link" href="/coherence">Join your team’s session <span aria-hidden="true">→</span></a><span class="mini-label">Individual reflection</span></div></article>
      <article class="tool-card" id="wayman"><div class="tool-card-top"><span class="tool-icon terra">${icon("book")}</span><span class="pill warm">For students</span></div><p class="eyebrow">Wayman Academy of Arts</p><h3>Small steps. Growing minds.</h3><p>Weekly science benchmarks that help students show what they know and help teachers understand where learning goes next.</p><div class="tool-meta"><span>${icon("book")}Grade 5 science</span><span>${icon("clock")}Weekly benchmarks</span></div><div class="tool-card-footer"><a class="text-link" href="#benchmarkList">View your benchmarks <span aria-hidden="true">→</span></a><span class="mini-label">2026–2027</span></div></article></div>
      <div class="join-strip"><span class="tool-icon">${icon("link")}</span><div><h3>Have a session link or code?</h3><p>Your facilitator or teacher will share everything you need to begin.</p></div><a href="/coherence" class="text-link">Enter session code <span aria-hidden="true">→</span></a></div>
      <section class="benchmarks-section" id="benchmarkList"><div class="section-label"><h2>Your weekly benchmarks</h2><span>Wayman Academy of Arts · Grade 5</span></div><div class="benchmark-list"><div class="benchmark-row"><span class="week-number">01</span><div><h3>Science · Benchmark 1</h3><p>Week 1 · 7 questions · Student code required</p></div><span class="pill">First benchmark</span><a href="/benchmark-1" class="button small secondary">Open assessment <span aria-hidden="true">→</span></a></div><div class="benchmark-row future"><span class="week-number">02</span><div><h3>Science · Benchmark 2</h3><p>Your teacher will let you know when it opens.</p></div><span class="pill neutral">Coming soon</span></div><div class="future-weeks">Weeks 3–22 will appear here as your teacher makes them available.</div></div></section>`, "Overview", "assessments");
    if (window.location.hash) requestAnimationFrame(() => document.querySelector(window.location.hash === "#wayman" ? "#wayman" : window.location.hash === "#leadership" ? "#leadership" : "#benchmarkList")?.scrollIntoView());
  }

  function renderCodeEntry() {
    setView(`<a href="/assessments" class="back-link">← Back to overview</a><section class="entry-layout"><div class="entry-story"><p class="eyebrow">Leadership Coherence Check</p><h1>A shared strategy starts with your perspective.</h1><p class="entry-description">Make space for an honest reflection on the work you are leading together.</p><ul class="entry-details"><li>${icon("target")}Eight dimensions of leadership coherence</li><li>${icon("people")}One team. Multiple perspectives.</li><li>${icon("lock")}Access with your session code and password</li></ul><p class="entry-quote">“From strategy in our heads to strategy we can lead together.”</p></div><div class="entry-form-area"><p class="eyebrow">Your team’s space</p><h2>Let’s find your session.</h2><p>Enter the session code from your facilitator. You’ll enter your shared password on the next screen.</p><form id="codeForm"><div class="field"><label for="sessionCode">Session code</label><input id="sessionCode" name="sessionCode" placeholder="e.g. leadership-demo" maxlength="80" pattern="[a-z0-9][a-z0-9-]{0,79}" required autocomplete="off" autocapitalize="none" spellcheck="false"><p class="helper">Use the code at the end of your team’s session link.</p></div><button class="button full" type="submit">Find my session <span aria-hidden="true">→</span></button><p class="status-message" id="codeStatus" role="status"></p></form><p class="form-note">Don’t have a code? Check with your facilitator.</p></div></section>`, "Join a session", "leadership");
    document.querySelector("#codeForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const code = document.querySelector("#sessionCode").value.trim();
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(code)) return;
      window.location.assign(/^benchmark-(?:[1-9]|1\d|2[0-2])$/.test(code) ? `/${encodeURIComponent(code)}` : `/coherence/${encodeURIComponent(code)}`);
    });
  }

  async function openSession(slug) {
    try {
      const result = await api(`session?session=${encodeURIComponent(slug)}`);
      session = result.session;
      mode = result.mode;
      authorized = result.authorized;
      if (session.status === "closed") return fail("Your facilitator has closed this session. Contact them if you need to make a change.", "This session has closed.");
      if (session.type === "benchmark" && session.benchmark !== 1) return renderComingSoon();
      if (portalIdentity?.role === "student" && session.type !== "benchmark") { window.location.replace("/assessments"); return; }
      if (authorized && session.type === "benchmark" && portalIdentity?.role === "student") {
        studentCode = portalIdentity.profile.studentCode;
        teacherName = portalIdentity.profile.teacherName;
        await loadQuestions();
        return;
      }
      if (authorized && session.type === "leadership") {
        restoreDraft();
        return renderLeadership();
      }
      renderAccess();
    } catch (error) { fail(error.message); }
  }

  function renderComingSoon() {
    setView(`<a href="/assessments#benchmarkList" class="back-link">← Back to your benchmarks</a><section class="confirmation"><span class="confirmation-icon">${icon("book")}</span><p class="eyebrow">Wayman Academy of Arts</p><h1>This benchmark is coming soon.</h1><p>Your teacher will share the assessment and password when it is ready. For now, you can return to the studio.</p><a class="button secondary" href="/assessments#benchmarkList">View benchmarks <span aria-hidden="true">→</span></a></section>`, "Coming soon", "wayman");
  }

  function renderAccess() {
    const leadership = session.type === "leadership";
    const needsPassword = !authorized;
    setView(`<a href="/assessments" class="back-link">← Back to overview</a>${notice()}<section class="entry-layout"><div class="entry-story"><p class="eyebrow">${leadership ? "Leadership Coherence Check" : "Wayman Academy of Arts · Grade 5"}</p><h1>${leadership ? "Your perspective.<br>Our next step forward." : `Science.<br>A little curiosity goes a long way.`}</h1><p class="entry-description">${leadership ? "Reflect on eight dimensions of your team’s work. Share an honest rating and a brief example for each to help shape your next conversation." : "Take your time, read each question carefully, and choose the answer that makes the most sense to you."}</p><ul class="entry-details">${leadership ? `<li>${icon("target")}Eight dimensions · A 1–5 rating for each</li><li>${icon("people")}Individual responses for a shared conversation</li><li>${icon("lock")}No individual account required</li>` : `<li>${icon("book")}Benchmark ${session.benchmark} · Week ${session.benchmark}</li><li>${icon("clock")}Work at your own pace</li><li>${icon("lock")}Use the student code your teacher gave you</li>`}</ul><p class="entry-quote">${leadership ? "“From strategy in our heads to strategy we can lead together.”" : "Every question is a chance to show what you know."}</p></div><div class="entry-form-area"><p class="eyebrow">${esc(session.organization)}</p><h2>${leadership ? "Welcome to your session." : "Before you begin."}</h2><p>${leadership ? `${esc(session.name)}<br>Enter the shared password from your facilitator to begin.` : "Enter your session password, student code, and teacher’s name. Your teacher can help if you’re missing anything."}</p><form id="accessForm">${needsPassword ? passwordField() : ""}${leadership ? "" : '<div class="field"><label for="studentCode">Student code</label><input id="studentCode" name="studentCode" placeholder="e.g. W5-001" maxlength="80" autocomplete="off" autocapitalize="none" spellcheck="false" required></div><div class="field"><label for="teacherName">Teacher’s name</label><input id="teacherName" name="teacherName" placeholder="e.g. Ms. Rivera" maxlength="120" autocomplete="off" required></div>'}<button class="button full" type="submit">${leadership ? "Begin my reflection" : "Start my assessment"} <span aria-hidden="true">→</span></button><p class="status-message" id="accessStatus" role="status"></p></form><p class="form-note">${leadership ? "No names are collected. Avoid identifying details in your examples." : "Use your student code, rather than your full name."}</p></div></section>${leadership ? `<div class="section-label"><h2>A look at the eight dimensions</h2><span>Room for every perspective.</span></div><div class="dimension-grid">${dimensions.map((dimension, index) => `<div class="dimension-chip"><span>${String(index + 1).padStart(2, "0")}</span>${dimension.name}</div>`).join("")}</div>` : ""}`, leadership ? "Leadership Coherence Check" : `Benchmark ${session.benchmark}`, leadership ? "leadership" : "wayman");
    bindPassword();
    document.querySelector("#accessForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      const status = document.querySelector("#accessStatus");
      button.disabled = true;
      status.textContent = "Opening your session…";
      if (!leadership) {
        studentCode = document.querySelector("#studentCode").value.trim();
        teacherName = document.querySelector("#teacherName").value.trim();
        if (!studentCode || !teacherName) { status.textContent = "Please enter your student code and teacher’s name."; button.disabled = false; return; }
      }
      try {
        const result = needsPassword ? await api("access", { session: session.slug, password: document.querySelector("#password").value }) : {mode, authorized: true};
        mode = result.mode;
        authorized = true;
        if (leadership) { restoreDraft(); renderLeadership(); } else { await loadQuestions(); }
        focusMain();
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  }

  function draftKey() { return `attenor-coherence-draft:${session.slug}`; }
  function saveDraft() {
    try { sessionStorage.setItem(draftKey(), JSON.stringify({ ratings, step, submissionId })); } catch { /* The form also works with storage disabled. */ }
  }
  function restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey()));
      if (draft && Array.isArray(draft.ratings) && draft.ratings.length === 8 && draft.ratings.every((rating) => rating && (rating.score === null || (Number.isInteger(rating.score) && rating.score >= 1 && rating.score <= 5)) && typeof rating.explanation === "string" && rating.explanation.length <= 1500)) {
        ratings = draft.ratings;
        step = Number.isInteger(draft.step) && draft.step >= 0 && draft.step <= 8 ? draft.step : 0;
        if (/^[0-9a-f-]{36}$/i.test(draft.submissionId || "")) submissionId = draft.submissionId;
      }
    } catch { /* Start with a clean form if a draft cannot be read. */ }
  }
  function isComplete(rating) { return rating.score !== null && !!rating.explanation.trim(); }
  function stepNav() {
    return `<nav class="step-nav" aria-label="Reflection dimensions">${dimensions.map((dimension, index) => `<button type="button" class="step-button ${isComplete(ratings[index]) ? "complete" : ""}" data-step="${index}" ${step === index ? 'aria-current="step"' : ""} aria-label="${index + 1}. ${dimension.name}${isComplete(ratings[index]) ? ", complete" : ""}"><span>${isComplete(ratings[index]) ? "✓" : String(index + 1).padStart(2, "0")}</span>${dimension.name}</button>`).join("")}</nav>`;
  }
  function leadershipFrame(content) {
    const completed = ratings.filter(isComplete).length;
    setView(`${notice()}<div class="participant-heading"><p class="eyebrow">${esc(session.organization)} · Individual reflection</p><h1>Leadership Coherence Check</h1><p>Rate what you see today. Your experience is the starting point.</p></div><div class="progress-meta"><span>${step === 8 ? "Review your reflection" : `Dimension ${step + 1} of 8`}</span><span>${completed} of 8 complete</span></div><div class="progress-track" role="progressbar" aria-label="Completed dimensions" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="8"><div class="progress-fill" style="width:${completed / 8 * 100}%"></div></div><div class="assessment-layout">${stepNav()}<section class="question-panel">${content}</section></div><p class="draft-note">Your draft stays in this browser tab until you submit or close the tab. Avoid identifying details.</p>`, "Your reflection", "leadership");
    document.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => { step = Number(button.dataset.step); saveDraft(); renderLeadership(); focusMain(); }));
  }
  function renderLeadership() {
    if (step === 8) return renderLeadershipReview();
    const dimension = dimensions[step];
    const rating = ratings[step];
    leadershipFrame(`<p class="eyebrow">Dimension ${String(step + 1).padStart(2, "0")}</p><h2 id="dimensionTitle">${dimension.name}</h2><p class="question-description">${dimension.description}</p><form id="reflectionForm"><fieldset class="rating-fieldset"><legend>How true is this for your team today?</legend><div class="rating-options">${anchors.map((anchor, index) => `<label class="rating-option"><input type="radio" name="rating" value="${index + 1}" ${rating.score === index + 1 ? "checked" : ""} required><span class="rating-box"><strong>${index + 1}</strong><small>${anchor}</small></span></label>`).join("")}</div><div class="rating-ends"><span>Not yet in place</span><span>Consistently in practice</span></div></fieldset><div class="field"><label for="explanation">What led you to this rating?</label><textarea id="explanation" name="explanation" placeholder="${esc(dimension.prompt)}" maxlength="1500" required>${esc(rating.explanation)}</textarea><p class="helper">A brief explanation or example is enough. <span id="characterCount">${rating.explanation.length}</span>/1,500 characters</p></div><p class="status-message" id="reflectionStatus" role="status"></p><div class="assessment-actions"><button type="button" class="button secondary" id="previousDimension" ${step === 0 ? "disabled" : ""}>← Back</button><button class="button" type="submit">${step === 7 ? "Review my reflection" : "Next dimension"} <span aria-hidden="true">→</span></button></div></form>`);
    const explanation = document.querySelector("#explanation");
    explanation.addEventListener("input", () => { ratings[step].explanation = explanation.value; document.querySelector("#characterCount").textContent = explanation.value.length; saveDraft(); });
    document.querySelectorAll('input[name="rating"]').forEach((input) => input.addEventListener("change", () => { ratings[step].score = Number(input.value); saveDraft(); }));
    document.querySelector("#previousDimension").addEventListener("click", () => { step--; saveDraft(); renderLeadership(); focusMain(); });
    document.querySelector("#reflectionForm").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!isComplete(ratings[step])) { document.querySelector("#reflectionStatus").textContent = "Choose a rating and add a brief explanation before continuing."; explanation.focus(); return; }
      step++; saveDraft(); renderLeadership(); focusMain();
    });
  }
  function renderLeadershipReview() {
    const incomplete = ratings.findIndex((rating) => !isComplete(rating));
    leadershipFrame(`<p class="eyebrow">One last look</p><h2>Make sure it feels like you.</h2><p class="question-description">Review your ratings and explanations before sharing your reflection with the session.</p>${dimensions.map((dimension, index) => `<div class="review-item"><span class="review-score">${ratings[index].score || "—"}</span><div><strong>${dimension.name}</strong><p>${esc(ratings[index].explanation || "Add your explanation.")}</p></div><button class="text-link" type="button" data-edit="${index}">Edit<span class="sr-only"> ${dimension.name}</span></button></div>`).join("")}<p class="status-message" id="submitStatus" role="status">${incomplete >= 0 ? "Some dimensions still need a rating and explanation." : ""}</p><div class="assessment-actions"><button class="button secondary" id="backToReflection" type="button">← Back</button><button class="button" id="submitReflection" type="button">${incomplete >= 0 ? "Finish my reflection" : "Submit my reflection"} <span aria-hidden="true">→</span></button></div>`);
    document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => { step = Number(button.dataset.edit); saveDraft(); renderLeadership(); focusMain(); }));
    document.querySelector("#backToReflection").addEventListener("click", () => { step = 7; renderLeadership(); focusMain(); });
    document.querySelector("#submitReflection").addEventListener("click", async (event) => {
      if (incomplete >= 0) { step = incomplete; renderLeadership(); focusMain(); return; }
      await submitResponse(event.currentTarget, { ratings: ratings.map((rating, index) => ({ dimension: dimensions[index].name, score: rating.score, explanation: rating.explanation.trim() })) });
    });
  }

  async function loadQuestions() {
    const result = await api(`questions?session=${encodeURIComponent(session.slug)}`);
    questions = result.questions;
    mode = result.mode;
    step = 0;
    renderBenchmark();
  }
  function renderBenchmark() {
    if (step === questions.length) return renderBenchmarkReview();
    const question = questions[step];
    const completed = questions.filter((item) => answers[item.id]).length;
    setView(`${notice()}<div class="participant-heading"><p class="eyebrow">Wayman Academy of Arts · Grade 5</p><h1>Science · Benchmark ${session.benchmark}</h1><p>Take your time. You can go back and change any answer before submitting.</p></div><div class="student-meta"><span>Student code: <strong>${esc(studentCode)}</strong></span><span>Teacher: ${esc(teacherName)}</span></div><div class="progress-meta"><span>Question ${step + 1} of ${questions.length}</span><span>${completed} answered</span></div><div class="progress-track" role="progressbar" aria-label="Answered questions" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${questions.length}"><div class="progress-fill" style="width:${completed / questions.length * 100}%"></div></div><div style="margin-top:26px"><nav class="question-dots" aria-label="Assessment questions">${questions.map((item, index) => `<button class="question-dot ${answers[item.id] ? "answered" : ""}" type="button" data-question="${index}" ${step === index ? 'aria-current="step"' : ""} aria-label="Question ${index + 1}${answers[item.id] ? ", answered" : ""}">${index + 1}</button>`).join("")}</nav><section class="question-panel"><p class="eyebrow">Question ${String(step + 1).padStart(2, "0")} ${question.standard_code ? `· ${esc(question.standard_code)}` : ""}</p><h2 id="questionTitle">${esc(question.question_text)}</h2><form id="benchmarkForm"><fieldset class="choice-fieldset"><legend>Choose one answer.</legend><div class="choice-options">${["A", "B", "C", "D"].map((letter) => `<label class="choice-option"><input type="radio" name="answer" value="${letter}" ${answers[question.id] === letter ? "checked" : ""} required><span class="choice-box"><span class="choice-letter">${letter}</span><span>${esc(question[`choice_${letter.toLowerCase()}`])}</span></span></label>`).join("")}</div></fieldset><div class="assessment-actions"><button class="button secondary" id="previousQuestion" type="button" ${step === 0 ? "disabled" : ""}>← Back</button><button class="button" type="submit">${step === questions.length - 1 ? "Review my answers" : "Next question"} <span aria-hidden="true">→</span></button></div></form></section></div><p class="draft-note">Keep this tab open until you have submitted. Your answers stay here as you move between questions.</p>`, `Benchmark ${session.benchmark}`, "wayman");
    document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => { step = Number(button.dataset.question); renderBenchmark(); focusMain(); }));
    document.querySelectorAll('input[name="answer"]').forEach((input) => input.addEventListener("change", () => { answers[question.id] = input.value; }));
    document.querySelector("#previousQuestion").addEventListener("click", () => { step--; renderBenchmark(); focusMain(); });
    document.querySelector("#benchmarkForm").addEventListener("submit", (event) => { event.preventDefault(); if (!answers[question.id]) return; step++; renderBenchmark(); focusMain(); });
  }
  function renderBenchmarkReview() {
    const incomplete = questions.findIndex((question) => !answers[question.id]);
    setView(`${notice()}<div class="participant-heading"><p class="eyebrow">Science · Benchmark ${session.benchmark}</p><h1>Ready to share your answers?</h1><p>Take one last look. You can change any answer before you submit.</p></div><section class="question-panel">${questions.map((question, index) => `<div class="review-item"><span class="review-score">${answers[question.id] || "—"}</span><div><strong>Question ${index + 1}</strong><p>${esc(question.question_text)}</p></div><button class="text-link" data-edit-question="${index}" type="button">${answers[question.id] ? "Change" : "Answer"}<span class="sr-only"> question ${index + 1}</span></button></div>`).join("")}<p class="status-message" id="submitStatus" role="status">${incomplete >= 0 ? "Please answer every question before submitting." : ""}</p><div class="assessment-actions"><button class="button secondary" type="button" id="backToQuestion">← Back</button><button class="button" id="submitBenchmark" type="button">${incomplete >= 0 ? "Finish my answers" : "Submit my answers"} <span aria-hidden="true">→</span></button></div></section>`, "Review your answers", "wayman");
    document.querySelectorAll("[data-edit-question]").forEach((button) => button.addEventListener("click", () => { step = Number(button.dataset.editQuestion); renderBenchmark(); focusMain(); }));
    document.querySelector("#backToQuestion").addEventListener("click", () => { step = questions.length - 1; renderBenchmark(); focusMain(); });
    document.querySelector("#submitBenchmark").addEventListener("click", async (event) => {
      if (incomplete >= 0) { step = incomplete; renderBenchmark(); focusMain(); return; }
      await submitResponse(event.currentTarget, { studentCode, teacherName, answers: questions.map((question) => ({ questionId: question.id, answer: answers[question.id] })) });
    });
  }
  async function submitResponse(button, payload) {
    const controls = [...main.querySelectorAll("button:not(:disabled)")];
    controls.forEach((control) => { control.disabled = true; });
    submitting = true;
    const status = document.querySelector("#submitStatus");
    status.textContent = "Submitting your response. Please keep this page open…";
    try {
      const result = await api("submit", { session: session.slug, submissionId, ...payload });
      mode = result.mode;
      if (session.type === "leadership") { try { sessionStorage.removeItem(draftKey()); } catch { /* Storage is optional. */ } }
      submitting = false;
      renderConfirmation(result.receipt);
      focusMain();
    } catch (error) {
      submitting = false;
      status.textContent = error.message;
      controls.forEach((control) => { control.disabled = false; });
    }
  }
  function renderConfirmation(receipt) {
    const leadership = session.type === "leadership";
    const time = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(receipt.submittedAt));
    setView(`${notice()}<section class="confirmation"><span class="confirmation-icon" aria-hidden="true">✓</span><p class="eyebrow">${leadership ? "Your voice is part of the picture" : "One more step forward"}</p><h1>${leadership ? "Thank you for your perspective." : "Great work. You did it!"}</h1><p>${mode === "preview" ? (storageMode === "database" ? "Your practice response has been saved to the test portal. Your teacher or facilitator can track it in their workspace." : "Your practice response was received in this preview. It will clear when the preview server restarts.") : leadership ? "Your reflection has been saved to your team’s session. Your facilitator will guide the conversation from here." : "Your answers have been saved. Your teacher will let you know what comes next."}</p><div class="receipt"><strong>${esc(session.name)}</strong>${esc(time)}<br>Receipt: ${esc(receipt.id)}</div><p>${leadership ? "You can close this tab and return to your team." : "You can close this tab now."}</p><a class="button secondary" href="/assessments">Back to the studio <span aria-hidden="true">→</span></a></section>`, "Response received", leadership ? "leadership" : "wayman");
  }

  async function openAdmin() {
    try {
      const result = await api("admin");
      adminSessions = result.sessions;
      mode = result.mode;
      renderAdmin();
      startAdminRefresh();
    } catch (error) { if (error.status === 401 || error.status === 403) window.location.replace("/portal"); else fail(error.message, "We couldn’t open the workspace yet."); }
  }
  function renderAdminLogin(message = "") {
    clearInterval(adminTimer);
    setView(`<a class="back-link" href="/assessments">← Back to overview</a><section class="entry-layout"><div class="entry-story"><p class="eyebrow">The facilitator workspace</p><h1>Make room for a better conversation.</h1><p class="entry-description">Create a shared space for reflection, invite your team, and keep each engagement organized.</p><ul class="entry-details"><li>${icon("link")}A unique link for every session</li><li>${icon("lock")}One shared participant password</li><li>${icon("people")}Switch between your team’s sessions</li></ul><p class="entry-quote">The clearest path forward begins with understanding where you are.</p></div><div class="entry-form-area"><p class="eyebrow">Facilitator access</p><h2>Welcome back.</h2><p>Enter your facilitator password to manage sessions. Your participant session password gives access to the reflection only.</p><form id="adminLogin">${passwordField("Facilitator password")}<button class="button full" type="submit">Open my workspace <span aria-hidden="true">→</span></button><p class="status-message" id="adminLoginStatus" role="status">${esc(message)}</p></form><p class="form-note">For authorized Attenor facilitators.</p></div></section>`, "Facilitator access", "facilitator");
    bindPassword();
    document.querySelector("#adminLogin").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      const status = document.querySelector("#adminLoginStatus");
      status.textContent = "Opening your workspace…";
      try {
        await api("admin", { action: "login", password: document.querySelector("#password").value });
        await openAdmin();
        focusMain();
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  }
  function adminHeading() {
    return `${notice()}<div class="page-heading"><div><p class="eyebrow">Clarity, one conversation at a time</p><h1>Your facilitator workspace.</h1><p>A place for every team. A clear view of every session.</p></div><button class="button small secondary" id="adminLogout" type="button">Sign out</button></div><div class="admin-tabs" role="tablist" aria-label="Workspace views"><button role="tab" id="sessionsTab" aria-controls="sessionsPanel" tabindex="${adminTab === "sessions" ? 0 : -1}" aria-selected="${adminTab === "sessions"}" data-tab="sessions">Session management</button><button role="tab" id="dashboardTab" aria-controls="dashboardPanel" tabindex="${adminTab === "dashboard" ? 0 : -1}" aria-selected="${adminTab === "dashboard"}" data-tab="dashboard">Facilitator view</button></div>`;
  }
  function bindAdmin() {
    document.querySelector("#adminLogout").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try { await portalRequest({ action: "logout" }); adminSessions = []; window.location.assign("/portal"); }
      catch (error) { document.querySelector("#adminStatus").textContent = error.message; event.currentTarget.disabled = false; }
    });
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => { adminTab = button.dataset.tab; renderAdmin(); });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        adminTab = event.key === "Home" ? "sessions" : event.key === "End" ? "dashboard" : adminTab === "sessions" ? "dashboard" : "sessions";
        renderAdmin();
        document.querySelector(`[data-tab="${adminTab}"]`).focus();
      });
    });
  }
  function renderAdmin() {
    if (adminTab === "dashboard") return renderDashboard();
    setView(`${adminHeading()}<section id="sessionsPanel" role="tabpanel" aria-labelledby="sessionsTab"><div class="admin-toolbar"><h2>Your sessions <span class="mini-label">(${adminSessions.length})</span></h2><button class="button small" id="newSession" type="button">+ Create a session</button></div><div id="sessionList">${adminSessions.length ? adminSessions.map((item) => `<article class="admin-session"><div class="session-top"><div><h3>${esc(item.name)}</h3><p>${esc(item.organization)} · ${item.type === "leadership" ? "Leadership Coherence Check" : `Grade 5 · Benchmark ${item.benchmark}`}</p></div><span class="pill ${item.status === "open" ? "" : "neutral"}">${item.status === "open" ? "Open" : item.status === "closed" ? "Closed" : "Coming soon"}</span></div><div class="session-url">${esc(fullUrl(item))}</div><div class="session-bottom"><span>${item.expectedParticipants ? `${item.expectedParticipants} expected participants` : "Student benchmark"} · <span data-session-count="${esc(item.slug)}">${item.responseCount === null ? "Response count pending" : `${item.responseCount} ${mode === "preview" ? "practice " : ""}${item.responseCount === 1 ? "response" : "responses"}`}</span></span><div><button class="text-link" data-copy="${esc(item.slug)}" type="button">Copy link</button>${item.status === "open" ? `<a class="text-link" href="${esc(routeFor(item))}" target="_blank" rel="noopener">Open session ↗</a>` : ""}<button class="text-link" data-view="${esc(item.slug)}" type="button">View session →</button></div></div></article>`).join("") : '<div class="empty-state">Create a session to get started.</div>'}</div></section><p class="status-message" id="adminStatus" role="status"></p>`, "Session management", "facilitator");
    bindAdmin();
    document.querySelector("#newSession").addEventListener("click", renderCreateSession);
    document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
      const item = adminSessions.find((candidate) => candidate.slug === button.dataset.copy);
      await copyText(fullUrl(item), button, document.querySelector("#adminStatus"));
    }));
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { selectedSlug = button.dataset.view; adminTab = "dashboard"; renderAdmin(); focusMain(); }));
  }
  async function copyText(value, button, status) {
    try { await navigator.clipboard.writeText(value); button.textContent = "Copied ✓"; status.textContent = "Link copied to clipboard."; }
    catch { status.textContent = `Copy this link: ${value}`; }
  }
  function renderCreateSession() {
    setView(`${adminHeading()}<section id="sessionsPanel" class="admin-create" role="tabpanel" aria-labelledby="sessionsTab"><p class="eyebrow">Bring your team together</p><h2>Create a new session.</h2><p>We’ll generate a unique participant link and a shared password for your team’s Leadership Coherence Check.</p><form id="createSessionForm"><div class="field"><label for="sessionName">Session name</label><input id="sessionName" name="sessionName" placeholder="e.g. Fall leadership reflection" maxlength="120" required></div><div class="field-row"><div class="field"><label for="organization">School or organization</label><input id="organization" name="organization" placeholder="e.g. Wayman Academy of Arts" maxlength="120" required></div><div class="field"><label for="teamSize">Expected participants</label><select id="teamSize" name="teamSize">${Array.from({ length: 11 }, (_, index) => `<option value="${index + 5}" ${index + 5 === 10 ? "selected" : ""}>${index + 5} participants</option>`).join("")}</select></div></div><p class="status-message" id="adminStatus" role="status"></p><div class="assessment-actions"><button class="button secondary" id="cancelCreate" type="button">Cancel</button><button class="button" type="submit">Create session <span aria-hidden="true">→</span></button></div></form></section>`, "Create a session", "facilitator");
    bindAdmin();
    document.querySelector("#cancelCreate").addEventListener("click", renderAdmin);
    document.querySelector("#createSessionForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      document.querySelector("#adminStatus").textContent = "Creating your session…";
      try {
        const result = await api("admin", { action: "create", name: document.querySelector("#sessionName").value.trim(), organization: document.querySelector("#organization").value.trim(), expectedParticipants: Number(document.querySelector("#teamSize").value) });
        adminSessions.push(result.session);
        renderCreatedSession(result);
        focusMain();
      } catch (error) { document.querySelector("#adminStatus").textContent = error.message; button.disabled = false; }
    });
  }
  function renderCreatedSession(result) {
    setView(`${notice()}<section class="confirmation"><span class="confirmation-icon" aria-hidden="true">${icon("link")}</span><p class="eyebrow">A space for your team</p><h1>Your session is ready.</h1><p>Share the link and password with your participants. Keep the password somewhere safe; it is shown here once.</p><dl class="credential-box"><dt>SESSION</dt><dd>${esc(result.session.name)}</dd><dt>PARTICIPANT LINK</dt><dd>${esc(fullUrl(result.session))}</dd><dt>SHARED PASSWORD</dt><dd><code>${esc(result.password)}</code></dd></dl><button class="button full" id="copyInvitation" type="button">Copy link and password ${icon("link")}</button><p class="status-message" id="adminStatus" role="status"></p><button class="text-link" style="margin-top:20px" id="backToSessions" type="button">Back to my sessions →</button></section>`, "Session created", "facilitator");
    document.querySelector("#copyInvitation").addEventListener("click", async (event) => {
      try { await navigator.clipboard.writeText(`${result.session.name}\n${fullUrl(result.session)}\nSession password: ${result.password}`); event.currentTarget.textContent = "Invitation copied ✓"; }
      catch { document.querySelector("#adminStatus").textContent = "Copy the link and password shown above to share your invitation."; }
    });
    document.querySelector("#backToSessions").addEventListener("click", () => { renderAdmin(); focusMain(); });
  }
  function analyticsPanel(selected) {
    const analytics = selected.analytics;
    if (selected.type === "leadership" && analytics?.ready) {
      return `<section class="analytics-panel" aria-labelledby="resultsTitle"><p class="eyebrow">Your team’s shared perspective</p><h3 id="resultsTitle">A clearer picture, together.</h3><p>Based on ${analytics.count} saved reflections. Ratings range from 1 to 5; a wider range means your team has more perspectives to explore.</p>${analytics.dimensions.map((item) => {
        const name = dimensions.find((dimension) => dimension.name.toLowerCase().replace(/\s+/g, "-") === item.dimension)?.name || item.dimension;
        const average = Number(item.average);
        return `<div class="analytics-dimension"><div><span>${esc(name)}</span><strong>${average.toFixed(1)} / 5</strong></div><div class="analytics-bar" role="img" aria-label="${esc(name)} average ${average.toFixed(1)} out of 5"><span style="width:${Math.max(0, Math.min(100, average / 5 * 100))}%"></span></div><p>Response range: ${esc(item.min)}–${esc(item.max)}</p></div>`;
      }).join("")}</section>`;
    }
    const count = selected.responseCount || 0;
    const threshold = analytics?.threshold || selected.expectedParticipants || 15;
    const leadership = selected.type === "leadership";
    return `<section class="hold-panel"><span class="tool-icon">${icon("chart")}</span><p class="eyebrow">${leadership ? "Every perspective adds to the picture" : "A growing picture of learning"}</p><h3>${leadership ? "Let’s hear from the whole team." : "Your students’ progress starts here."}</h3><p>${leadership ? `${count} of ${threshold} expected reflections received. Team averages and response ranges appear here once the response threshold is reached.` : `${count} benchmark ${count === 1 ? "response has" : "responses have"} been received. Submission tracking is available now. Scores and learning trends will appear after the scoring connection is verified.`}</p>${leadership ? `<div class="readiness-progress"><div class="progress-track" role="progressbar" aria-label="Reflections received" aria-valuenow="${Math.min(count, threshold)}" aria-valuemin="0" aria-valuemax="${threshold}"><div class="progress-fill" style="width:${Math.min(100, count / threshold * 100)}%"></div></div><span>${count} / ${threshold} reflections</span></div>` : ""}</section>`;
  }

  function renderDashboard() {
    const selected = adminSessions.find((item) => item.slug === selectedSlug) || adminSessions[0];
    selectedSlug = selected?.slug || "";
    setView(`${adminHeading()}<section id="dashboardPanel" role="tabpanel" aria-labelledby="dashboardTab"><div class="admin-toolbar"><div class="field session-picker"><label for="sessionPicker">Viewing session</label><select id="sessionPicker">${adminSessions.map((item) => `<option value="${esc(item.slug)}" ${selected?.slug === item.slug ? "selected" : ""}>${esc(item.name)} · ${esc(item.organization)}</option>`).join("")}</select></div><span class="connection-state" id="refreshState">${storageMode === "database" ? "Saved responses · refreshes every 10 seconds" : "Preview · refreshes every 10 seconds"}</span></div>${selected ? `<div class="stat-row"><div class="stat-card"><span>${mode === "preview" ? "Practice responses" : "Responses received"}</span><strong id="responseCount">${selected.responseCount ?? "—"}</strong><small>${selected.expectedParticipants ? `of ${selected.expectedParticipants} expected` : "this session"}</small></div><div class="stat-card"><span>Session status</span><strong style="font-size:24px">${selected.status === "open" ? "Open" : selected.status === "closed" ? "Closed" : "Coming soon"}</strong><small>${selected.type === "leadership" ? "Team reflection" : "Student benchmark"}</small></div><div class="stat-card"><span>Assessment</span><strong>${selected.type === "leadership" ? "8" : "7"}</strong><small>${selected.type === "leadership" ? "dimensions" : "questions"}</small></div></div><div id="analyticsContent">${analyticsPanel(selected)}</div>` : '<div class="empty-state">Create a session to see it here.</div>'}</section><p class="status-message" id="adminStatus" role="status"></p>`, "Facilitator view", "facilitator");
    bindAdmin();
    document.querySelector("#sessionPicker").addEventListener("change", (event) => { selectedSlug = event.currentTarget.value; renderDashboard(); });
  }
  function startAdminRefresh() {
    clearInterval(adminTimer);
    adminTimer = setInterval(async () => {
      if (document.hidden || pollBusy) return;
      pollBusy = true;
      try {
        const result = await api("admin");
        adminSessions = result.sessions;
        document.querySelectorAll("[data-session-count]").forEach((element) => {
          const count = adminSessions.find((item) => item.slug === element.dataset.sessionCount)?.responseCount;
          element.textContent = count === null || count === undefined ? "Response count pending" : `${count} ${mode === "preview" ? "practice " : ""}${count === 1 ? "response" : "responses"}`;
        });
        const analytics = document.querySelector("#analyticsContent");
        if (analytics) { const selected = adminSessions.find((item) => item.slug === selectedSlug); if (selected) analytics.innerHTML = analyticsPanel(selected); }
        const counter = document.querySelector("#responseCount");
        if (counter) counter.textContent = adminSessions.find((item) => item.slug === selectedSlug)?.responseCount ?? "—";
        const state = document.querySelector("#refreshState");
        if (state) state.textContent = storageMode === "database" ? "Saved responses · refreshes every 10 seconds" : "Preview · refreshes every 10 seconds";
      } catch (error) {
        if (error.status === 401 || error.status === 403) { adminSessions = []; window.location.replace("/portal"); }
        else if (document.querySelector("#refreshState")) document.querySelector("#refreshState").textContent = "Refresh paused · reconnecting";
      } finally { pollBusy = false; }
    }, 10000);
  }

  window.addEventListener("beforeunload", (event) => {
    if (submitting || (session?.type === "benchmark" && questions.length && Object.keys(answers).length && !document.querySelector(".confirmation"))) { event.preventDefault(); event.returnValue = ""; }
  });
  document.addEventListener("click", (event) => {
    if (submitting) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.querySelector("[data-year]").textContent = new Date().getFullYear();
  bootstrap();
})();
