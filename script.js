const captureForm = document.querySelector("#captureForm");
const bookingPanel = document.querySelector("#bookingPanel");
const formNote = document.querySelector("#formNote");

captureForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const email = new FormData(captureForm).get("email");
  formNote.textContent = `Thanks. The resource hub is ready, and booking is unlocked for ${email}.`;
  bookingPanel.hidden = false;
  bookingPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
