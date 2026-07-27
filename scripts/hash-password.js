const { randomBytes, scryptSync } = require("node:crypto");
function printHash(password) {
  if (password.length < 12) {
    console.error("Use a password containing at least 12 characters.");
    process.exitCode = 1;
    return;
  }

  const salt = randomBytes(24).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  console.log(`\nPassword hash:\nscrypt$${salt}$${hash}`);
  console.log("\nStore only this hash in ATTENOR_ACCOUNTS_JSON. Do not commit the password.");
}

if (!process.stdin.isTTY) {
  let password = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (password += chunk));
  process.stdin.on("end", () => printHash(password.trimEnd()));
} else {
  let password = "";
  process.stdout.write("Password to hash: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key) => {
    if (key === "\u0003") process.exit(130);
    if (key === "\r" || key === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      printHash(password);
      return;
    }
    if (key === "\u007f") {
      password = password.slice(0, -1);
      return;
    }
    password += key;
  });
}
