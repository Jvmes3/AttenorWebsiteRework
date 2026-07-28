const accountName = document.querySelector("#accountName");
const impactToolbar = document.querySelector("#impactToolbar");
const impactStatus = document.querySelector("#impactStatus");
const documentGrid = document.querySelector("#documentGrid");
const logoutButton = document.querySelector("#logoutButton");
const documentViewer = document.querySelector("#documentViewer");
const viewerTitle = document.querySelector("#viewerTitle");
const documentFrame = document.querySelector("#documentFrame");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomInButton = document.querySelector("#zoomInButton");
const zoomLevel = document.querySelector("#zoomLevel");
const printLink = document.querySelector("#printLink");
const downloadLink = document.querySelector("#downloadLink");
let selectedDocument = null;
let selectedZoom = 1;

function documentUrl(item, mode = "view") {
  const parameters = new URLSearchParams({ id: item.id, mode });
  if (mode === "view") parameters.set("zoom", selectedZoom);
  return `/api/impact-document?${parameters}`;
}

function openDocument(item, shouldScroll = true) {
  selectedDocument = item;
  selectedZoom = 1;
  viewerTitle.textContent = item.title;
  documentFrame.title = item.title;
  documentFrame.src = documentUrl(item);
  printLink.href = documentUrl(item, "print");
  downloadLink.href = documentUrl(item, "download");
  zoomLevel.textContent = "100%";
  zoomOutButton.disabled = false;
  zoomInButton.disabled = false;
  documentViewer.hidden = false;

  document.querySelectorAll(".document-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.documentId === item.id);
  });

  if (shouldScroll) documentViewer.scrollIntoView({ behavior: "smooth", block: "start" });
}

function changeZoom(amount) {
  if (!selectedDocument) return;
  selectedZoom = Math.min(1.5, Math.max(0.6, Math.round((selectedZoom + amount) * 10) / 10));
  zoomLevel.textContent = `${Math.round(selectedZoom * 100)}%`;
  zoomOutButton.disabled = selectedZoom <= 0.6;
  zoomInButton.disabled = selectedZoom >= 1.5;
  documentFrame.src = documentUrl(selectedDocument);
}

function renderDocuments(documents) {
  documentGrid.replaceChildren();

  if (!documents.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No documents have been assigned to this account yet.";
    documentGrid.append(empty);
    return;
  }

  documents.forEach((item) => {
    const card = documentGrid.appendChild(document.createElement("article"));
    card.className = "document-card";
    card.dataset.documentId = item.id;

    const type = card.appendChild(document.createElement("p"));
    type.className = "resource-type";
    type.textContent = "Interactive private document";

    card.appendChild(document.createElement("h2")).textContent = item.title;
    card.appendChild(document.createElement("p")).textContent = item.description || "Prepared for your account.";

    const button = card.appendChild(document.createElement("button"));
    button.className = "download-link document-open-button";
    button.type = "button";
    button.textContent = "Open document";
    button.addEventListener("click", () => openDocument(item));
  });

  openDocument(documents[0], false);
}

async function loadAccount() {
  try {
    const response = await fetch("/api/session");
    if (response.status === 401) {
      window.location.replace("/login");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Account access is temporarily unavailable.");

    accountName.textContent = result.account.displayName || result.account.username;
    impactToolbar.hidden = false;
    impactStatus.textContent = "";
    renderDocuments(result.account.documents || []);
  } catch (error) {
    impactStatus.textContent = error.message;
  }
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  await fetch("/api/logout", { method: "POST" });
  window.location.replace("/login");
});

zoomOutButton.addEventListener("click", () => changeZoom(-0.1));
zoomInButton.addEventListener("click", () => changeZoom(0.1));

loadAccount();
