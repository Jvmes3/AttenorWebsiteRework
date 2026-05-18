const captureForm = document.querySelector("#captureForm");
const bookingPanel = document.querySelector("#bookingPanel");
const formNote = document.querySelector("#formNote");
const faqToggle = document.querySelector("#faqToggle");
const faqPanel = document.querySelector("#faqAgentPanel");
const faqClose = document.querySelector("#faqClose");
const faqForm = document.querySelector("#faqForm");
const faqInput = document.querySelector("#faqInput");
const faqMessages = document.querySelector("#faqMessages");
const faqPrompts = document.querySelectorAll(".faq-prompt");

const faqAnswers = [
  {
    keywords: ["what", "do", "services", "attenor", "help"],
    answer:
      "Attenor Collaborative helps leaders make better decisions in complex environments through strategic foresight, research and evaluation, and executive coaching.",
  },
  {
    keywords: ["foresight", "scenario", "future", "futures", "signals"],
    answer:
      "The foresight work includes horizon scanning, signals analysis, scenario planning, and decision frameworks that help teams prepare for multiple possible futures.",
  },
  {
    keywords: ["research", "evaluation", "evidence", "data"],
    answer:
      "The research and evaluation work helps teams clarify what is working, what is changing, and why it matters through applied research design, stakeholder discovery, analysis, and practical recommendations.",
  },
  {
    keywords: ["coaching", "executive", "leadership", "leader"],
    answer:
      "Executive coaching supports leaders navigating growth, ambiguity, team alignment, and the behavioral shifts required to lead through change.",
  },
  {
    keywords: ["resource", "download", "guide", "checklist", "brief"],
    answer:
      "The resource hub includes a Strategic Foresight Starter Kit, Evaluation Readiness Checklist, and Leadership Alignment Questions. Each one is downloadable from the Resource Hub section.",
  },
  {
    keywords: ["book", "booking", "call", "consultation", "discovery"],
    answer:
      "Use the booking section to enter your work email and unlock the discovery call request. The first call is a 30-minute conversation about fit, urgency, and next steps.",
  },
  {
    keywords: ["content", "agent", "calendar", "caption", "post", "sources"],
    answer:
      "The Content Agent checks Google Calendar, activates on scheduled content days, reads the event brief, researches current sources, and saves a caption, post body, and source links to Google Drive.",
  },
  {
    keywords: ["email", "gmail", "outlook", "inbox", "summary", "tasks", "label"],
    answer:
      "The Email Agent runs each morning, reviews Gmail and Outlook, labels new messages, extracts tasks and deadlines, and produces one summary showing the sender, inbox source, priority, and required action.",
  },
  {
    keywords: ["drive", "google", "tools", "claude"],
    answer:
      "The proposed automation stack includes Google Calendar, web search, Claude AI, Google Drive, Gmail, and Outlook. Output can be organized in Drive folders for review and reuse.",
  },
];

captureForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const email = new FormData(captureForm).get("email");
  formNote.textContent = `Thanks. The resource hub is ready, and booking is unlocked for ${email}.`;
  bookingPanel.hidden = false;
  bookingPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

function setFaqOpen(isOpen) {
  if (!faqPanel || !faqToggle) return;

  faqPanel.hidden = !isOpen;
  faqToggle.setAttribute("aria-expanded", String(isOpen));

  if (isOpen) {
    faqInput?.focus();
  }
}

function addMessage(text, type) {
  if (!faqMessages) return;

  const message = document.createElement("div");
  message.className = `message ${type}`;
  message.textContent = text;
  faqMessages.append(message);
  faqMessages.scrollTop = faqMessages.scrollHeight;
}

function getFaqAnswer(question) {
  const normalizedQuestion = question.toLowerCase();
  const scoredAnswers = faqAnswers.map((item) => {
    const score = item.keywords.reduce((total, keyword) => {
      return normalizedQuestion.includes(keyword) ? total + 1 : total;
    }, 0);

    return { ...item, score };
  });
  const bestMatch = scoredAnswers.sort((a, b) => b.score - a.score)[0];

  if (bestMatch?.score) {
    return bestMatch.answer;
  }

  return "I can help with Attenor services, downloadable resources, discovery calls, and the Content Agent or Email Agent proposal. Try asking about one of those.";
}

function askFaqAgent(question) {
  const trimmedQuestion = question.trim();

  if (!trimmedQuestion) return;

  setFaqOpen(true);
  addMessage(trimmedQuestion, "user");
  addMessage(getFaqAnswer(trimmedQuestion), "bot");

  if (faqInput) {
    faqInput.value = "";
  }
}

faqToggle?.addEventListener("click", () => {
  setFaqOpen(faqPanel?.hidden ?? true);
});

faqClose?.addEventListener("click", () => {
  setFaqOpen(false);
});

faqForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  askFaqAgent(new FormData(faqForm).get("question") || "");
});

faqPrompts.forEach((prompt) => {
  prompt.addEventListener("click", () => {
    askFaqAgent(prompt.dataset.question || prompt.textContent || "");
  });
});
