(() => {
  "use strict";
  const main = document.querySelector("#main");
  const home = window.location.hostname === "wayman.attenorcollab.com" ? "/" : "/wayman";
  document.querySelectorAll('a[href="/wayman"]').forEach((link) => { link.href = home; });
  const match = window.location.pathname.replace(/\/$/, "").match(/^\/benchmark-([1-9]|1\d|2[0-2])$/);
  const benchmark = match ? Number(match[1]) : null;
  let catalog = [];
  let year = "";
  let mode = "preview";
  let questions = [];
  let answers = {};
  let studentNumber = "";
  let teacherName = "";
  let attemptId = "";
  let step = 0;
  let submitting = false;
  let finished = false;

  function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
  function notice() { return mode === "preview" ? '<div class="notice"><strong>Test preview</strong> · Use practice student numbers. Responses submitted here are test records.</div>' : ""; }
  function view(content, title) { main.innerHTML = content; document.title = `${title} | Wayman Academy of Arts`; }
  function focusMain() { main.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); }
  async function request(body) {
    let response;
    try { response = await fetch(body ? "/api/wayman" : "/api/wayman?action=catalog", { method: body ? "POST" : "GET", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error("We couldn’t reach the benchmark service. Keep this page open and try again."); }
    let result;
    try { result = await response.json(); } catch { throw new Error("The benchmark service is unavailable. Please try again shortly."); }
    if (!response.ok) throw new Error(result.error || "Please check with your teacher and try again.");
    return result;
  }
  function directory() {
    const available = catalog.filter((item) => item.available).length;
    view(`${notice()}<section class="wayman-welcome"><div><p class="eyebrow">Grade 5 science · ${esc(year)}</p><h1>Small steps.<br><em>Growing minds.</em></h1><p>A little thinking. A little exploring. Choose a benchmark and show what you know.</p></div><div class="wayman-welcome-note"><span aria-hidden="true">✦</span><strong>Your number.<br>Your progress.</strong><p>Use the same student number all school year. Your teacher has your number if you need a reminder.</p></div></section><section aria-labelledby="benchmarksTitle"><div class="section-label"><h2 id="benchmarksTitle">Choose your benchmark</h2><span>${available} with questions ready · 22 benchmark pages</span></div><p class="wayman-makeup-note">Missed a benchmark? Come back to it anytime. There are no weekly locks.</p><div class="wayman-benchmark-grid">${catalog.map((item) => `<a class="wayman-benchmark-card ${item.available ? "" : "questions-pending"}" href="/benchmark-${item.benchmark}"><div><span class="week-number">${String(item.benchmark).padStart(2, "0")}</span><span class="pill ${item.available ? "" : "neutral"}">${item.available ? "Ready" : "Questions being prepared"}</span></div><h3>Benchmark ${item.benchmark}</h3><p>${item.available ? `${item.questionCount} questions · Work at your own pace` : "Your teacher will confirm when the questions are ready."}</p><span class="text-link">${item.available ? "Start benchmark" : "View benchmark"} <span aria-hidden="true">→</span></span></a>`).join("")}</div></section>`, "Science benchmarks");
  }
  function entry() {
    const item = catalog.find((candidate) => candidate.benchmark === benchmark);
    if (!item?.available) {
      view(`${notice()}<a class="back-link" href="${home}">← All benchmarks</a><section class="confirmation"><span class="confirmation-icon" aria-hidden="true">✦</span><p class="eyebrow">Science · Benchmark ${benchmark}</p><h1>The questions are being prepared.</h1><p>This benchmark page is always here. Your teacher will let you know when its questions are ready.</p><a class="button secondary" href="${home}">See all benchmarks →</a></section>`, `Benchmark ${benchmark}`);
      return;
    }
    view(`<a class="back-link" href="${home}">← All benchmarks</a>${notice()}<section class="entry-layout"><div class="entry-story"><p class="eyebrow">Wayman Academy of Arts · ${esc(year)}</p><h1>A little curiosity<br>goes a long way.</h1><p class="entry-description">Read each question carefully, take your time, and choose the answer that makes the most sense to you.</p><ul class="entry-details"><li>✦ Grade 5 science</li><li>✦ Benchmark ${benchmark} · ${item.questionCount} questions</li><li>✦ No account or password needed</li></ul><p class="entry-quote">Every question is a chance to show what you know.</p></div><div class="entry-form-area"><p class="eyebrow">Science · Benchmark ${benchmark}</p><h2>Before you begin.</h2><p>Enter the student number your teacher assigned you and your teacher’s name.</p><form id="beginForm"><div class="field"><label for="studentNumber">Student number</label><input id="studentNumber" name="studentNumber" type="text" inputmode="numeric" pattern="[0-9]{1,40}" maxlength="40" placeholder="e.g. 0017" autocomplete="off" required><p class="helper">Use the same number all year, including any zeros at the beginning. Do not enter your name.</p></div><div class="field"><label for="teacherName">Teacher’s name</label><input id="teacherName" name="teacherName" type="text" maxlength="120" placeholder="e.g. Ms. Rivera" autocomplete="off" required></div><button class="button full" type="submit">Start benchmark <span aria-hidden="true">→</span></button><p class="status-message" id="beginStatus" role="status"></p></form><p class="form-note">Forgot your number? Your teacher has the master list.</p></div></section>`, `Benchmark ${benchmark}`);
    document.querySelector("#beginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const controls = [...form.querySelectorAll("input,button")];
      studentNumber = form.elements.studentNumber.value.trim();
      teacherName = form.elements.teacherName.value.trim();
      if (!/^\d{1,40}$/.test(studentNumber) || !teacherName) { document.querySelector("#beginStatus").textContent = "Enter your student number and teacher’s name to begin."; return; }
      controls.forEach((control) => { control.disabled = true; });
      document.querySelector("#beginStatus").textContent = "Opening your benchmark…";
      try {
        const result = await request({ action: "begin", benchmark, studentNumber, teacherName });
        questions = result.questions; attemptId = result.attemptId; mode = result.mode; year = result.schoolYear;
        question(); focusMain();
      } catch (error) { document.querySelector("#beginStatus").textContent = error.message; controls.forEach((control) => { control.disabled = false; }); }
    });
  }
  function question() {
    if (step === questions.length) return review();
    const item = questions[step];
    const completed = questions.filter((candidate) => answers[candidate.id]).length;
    view(`${notice()}<div class="participant-heading"><p class="eyebrow">Grade 5 science · ${esc(year)}</p><h1>Benchmark ${benchmark}</h1><p>You can go back and change any answer before submitting.</p></div><div class="student-meta"><span>Student number: <strong>${esc(studentNumber)}</strong></span><span>Teacher: ${esc(teacherName)}</span></div><div class="progress-meta"><span>Question ${step + 1} of ${questions.length}</span><span>${completed} answered</span></div><div class="progress-track" role="progressbar" aria-label="Answered questions" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${questions.length}"><div class="progress-fill" style="width:${completed / questions.length * 100}%"></div></div><nav class="question-dots wayman-question-dots" aria-label="Assessment questions">${questions.map((candidate, index) => `<button class="question-dot ${answers[candidate.id] ? "answered" : ""}" type="button" data-question="${index}" ${step === index ? 'aria-current="step"' : ""} aria-label="Question ${index + 1}${answers[candidate.id] ? ", answered" : ""}">${index + 1}</button>`).join("")}</nav><section class="question-panel"><p class="eyebrow">Question ${String(step + 1).padStart(2, "0")}${item.standard_code ? ` · ${esc(item.standard_code)}` : ""}</p><h2 id="questionTitle">${esc(item.question_text)}</h2><form id="questionForm"><fieldset class="choice-fieldset"><legend>Choose one answer.</legend><div class="choice-options">${["A", "B", "C", "D"].map((letter) => `<label class="choice-option"><input type="radio" name="answer" value="${letter}" ${answers[item.id] === letter ? "checked" : ""} required><span class="choice-box"><span class="choice-letter">${letter}</span><span>${esc(item[`choice_${letter.toLowerCase()}`])}</span></span></label>`).join("")}</div></fieldset><div class="assessment-actions"><button class="button secondary" id="previousQuestion" type="button" ${step === 0 ? "disabled" : ""}>← Back</button><button class="button" type="submit">${step === questions.length - 1 ? "Review my answers" : "Next question"} →</button></div></form></section><p class="draft-note">Keep this tab open until you have submitted. Answers stay here as you move between questions.</p>`, `Benchmark ${benchmark}`);
    document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => { step = Number(button.dataset.question); question(); focusMain(); }));
    document.querySelectorAll('input[name="answer"]').forEach((input) => input.addEventListener("change", () => { answers[item.id] = input.value; }));
    document.querySelector("#previousQuestion").addEventListener("click", () => { step--; question(); focusMain(); });
    document.querySelector("#questionForm").addEventListener("submit", (event) => { event.preventDefault(); if (answers[item.id]) { step++; question(); focusMain(); } });
  }
  function review() {
    const missing = questions.findIndex((item) => !answers[item.id]);
    view(`${notice()}<div class="participant-heading"><p class="eyebrow">Science · Benchmark ${benchmark}</p><h1>Ready to share your answers?</h1><p>Take one last look. You can change any answer before you submit.</p></div><section class="question-panel">${questions.map((item, index) => `<div class="review-item"><span class="review-score">${answers[item.id] || "—"}</span><div><strong>Question ${index + 1}</strong><p>${esc(item.question_text)}</p></div><button class="text-link" data-edit="${index}" type="button">${answers[item.id] ? "Change" : "Answer"}<span class="sr-only"> question ${index + 1}</span></button></div>`).join("")}<p class="status-message" id="submitStatus" role="status">${missing >= 0 ? "Please answer every question before submitting." : ""}</p><div class="assessment-actions"><button class="button secondary" id="backToQuestions" type="button">← Back</button><button class="button" id="submitAnswers" type="button">${missing >= 0 ? "Finish my answers" : "Submit my answers"} →</button></div></section>`, "Review your answers");
    document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => { step = Number(button.dataset.edit); question(); focusMain(); }));
    document.querySelector("#backToQuestions").addEventListener("click", () => { step = questions.length - 1; question(); focusMain(); });
    document.querySelector("#submitAnswers").addEventListener("click", async () => {
      if (missing >= 0) { step = missing; question(); focusMain(); return; }
      const controls = [...main.querySelectorAll("button")];
      controls.forEach((button) => { button.disabled = true; }); submitting = true;
      document.querySelector("#submitStatus").textContent = "Saving your answers. Please keep this page open…";
      try {
        const result = await request({ action: "submit", benchmark, submissionId: attemptId, answers: questions.map((item) => ({ questionId: item.id, answer: answers[item.id] })) });
        submitting = false; finished = true; confirmation(result); focusMain();
      } catch (error) { submitting = false; document.querySelector("#submitStatus").textContent = error.message; controls.forEach((button) => { button.disabled = false; }); }
    });
  }
  function confirmation(result) {
    mode = result.mode;
    view(`${notice()}<section class="confirmation"><span class="confirmation-icon" aria-hidden="true">✓</span><p class="eyebrow">Science · Benchmark ${benchmark}</p><h1>Great work. You did it!</h1><p>${mode === "preview" ? "Your practice answers have been saved to the test site." : "Your answers have been saved. Your teacher will let you know what comes next."}</p><div class="receipt"><strong>Benchmark ${benchmark} · ${esc(result.schoolYear)}</strong>Receipt: ${esc(result.receipt.id)}</div><p>You can close this tab now, or return to the benchmark list.</p><a class="button secondary" href="${home}">All benchmarks →</a></section>`, "Answers saved");
  }
  document.addEventListener("click", (event) => { if (submitting) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  window.addEventListener("beforeunload", (event) => { if (submitting || (!finished && Object.keys(answers).length)) { event.preventDefault(); event.returnValue = ""; } });
  (async () => {
    try {
      const result = await request(); catalog = result.benchmarks; year = result.schoolYear; mode = result.mode;
      benchmark ? entry() : directory();
    } catch (error) {
      view(`<section class="error-card"><p class="eyebrow">Wayman science benchmarks</p><h1>Let’s try that again.</h1><p role="status">${esc(error.message)}</p><button class="button" type="button" id="retry">Try again →</button></section>`, "Benchmark access");
      document.querySelector("#retry").addEventListener("click", () => window.location.reload());
    }
  })();
})();
