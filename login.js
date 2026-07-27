const loginForm = document.querySelector("#loginForm");
const loginStatus = document.querySelector("#loginStatus");
const impactNavLink = document.querySelector(".impact-nav-link");

async function checkExistingSession() {
  try {
    const response = await fetch("/api/session");
    if (response.ok) impactNavLink.hidden = false;
  } catch {
    // The sign-in form will report any service problem on submit.
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button[type="submit"]');
  const formData = new FormData(loginForm);
  button.disabled = true;
  loginStatus.textContent = "Signing in…";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign in failed.");
    window.location.assign("/impact");
  } catch (error) {
    loginStatus.textContent = error.message;
    button.disabled = false;
  }
});

checkExistingSession();
