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
const resourceSection = document.querySelector("#resources");
const resourceCards = document.querySelectorAll(".resource-card");
const lockedResourceLinks = document.querySelectorAll(".locked-link");
const unlockedResourceLinks = document.querySelectorAll(".unlocked-link");

const faqAnswers = [
  {
    keywords: ["what", "do", "services", "attenor", "help"],
    answer:
      "Attenor Collaborative helps senior leaders develop the capacity to lead intentionally into what is coming. Through strategic foresight, research and evaluation, and executive coaching, we help leaders read what is changing in their environment, make sense of what it means for their work, and move forward with clarity and confidence. We do not just advise and leave. We build alongside you.",
  },
  {
    keywords: ["who", "work", "typically", "executives", "founders", "leaders"],
    answer:
      "We work with accomplished senior leaders who have built real success and are not done. They are executives, founders, and organizational leaders who sense that the world is shifting in ways their current strategy does not yet account for. They are not in crisis. They are in transition, and they are wise enough to invest in their thinking before the future arrives uninvited.",
  },
  {
    keywords: ["discovery", "call", "expect", "pitch", "fit"],
    answer:
      "The discovery call is not a pitch. It is a conversation designed to clarify three things: whether there is a real fit, what your most urgent need is right now, and what a next step could look like. You will leave with at least one useful insight regardless of whether we work together. Most people find it valuable just to have the conversation.",
  },
  {
    keywords: ["different", "traditional", "executive", "coaching", "futures"],
    answer:
      "Most executive coaching focuses on your behavior, your goals, and your accountability. That work has value. What Attenor adds is a futures layer. We help you lift your head from the immediate and read what is emerging in your industry, your community, and the broader world before it catches you off guard. The result is a leader who is not just performing well today but positioned well for what is coming.",
  },
  {
    keywords: ["resource", "resources", "download", "access", "guide", "map", "tools"],
    answer:
      "Attenor Collaborative offers three downloadable tools designed to help leaders start better conversations before they are ready for a full engagement. The Signal and Scenario Map helps you read emerging signals and test whether your current strategy is built for the world you are heading into. The Strategy Workflow Map helps you backcast from a long term destination to this year's priorities. The Coherence Map helps your team move from knowing the strategy to being able to speak to it together. Share your email to access all three.",
  },
];

captureForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(captureForm);
  const firstName = formData.get("firstName");
  const email = formData.get("email");
  formNote.textContent = `Thanks${firstName ? `, ${firstName}` : ""}. The resource PDFs are unlocked below, and booking is ready for ${email}.`;
  resourceCards.forEach((card) => {
    card.classList.remove("is-locked");
    card.classList.add("is-unlocked");
  });
  lockedResourceLinks.forEach((link) => {
    link.hidden = true;
  });
  unlockedResourceLinks.forEach((link) => {
    link.hidden = false;
  });
  bookingPanel.hidden = false;
  resourceSection?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  return "I can help with Attenor Collaborative services, resources, discovery calls, who we work with, and how this differs from traditional executive coaching. Try asking about one of those.";
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
