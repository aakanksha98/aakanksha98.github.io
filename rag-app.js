const API_BASE_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const fileInput = document.querySelector("#fileInput");
const uploadButton = document.querySelector("#uploadButton");
const composerUploadButton = document.querySelector("#composerUploadButton");
const sidebarOpenButton = document.querySelector("#sidebarOpenButton");
const sidebarCloseButton = document.querySelector("#sidebarCloseButton");
const sidebarOverlay = document.querySelector("#sidebarOverlay");
const clearButton = document.querySelector("#clearButton");
const notice = document.querySelector("#notice");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const chatMessages = document.querySelector("#chatMessages");
const chatForm = document.querySelector("#chatForm");
const questionInput = document.querySelector("#questionInput");
const sendButton = document.querySelector("#sendButton");
const documentList = document.querySelector("#documentList");
const documentCount = document.querySelector("#documentCount");
const pollyCard = document.querySelector("#pollyCard");
const pollyButton = document.querySelector("#pollyButton");
const pollyStatus = document.querySelector("#pollyStatus");
const pollyText = document.querySelector("#pollyText");

let busy = false;
let indexedDocuments = [];
let pollyTipIndex = 0;

const initialMessage = chatMessages.innerHTML;
const initialPlaceholder = questionInput.placeholder;
const pollyTips = [
  "Upload a document first. Once it is indexed, questions use retrieved chunks instead of guessing.",
  "Good demo questions are specific: ask about a policy, date, responsibility, benefit, or project detail from the uploaded file.",
  "Sources are the trust signal. Open each source row to see the supporting snippet.",
  "If an answer feels off, ask a narrower question or upload a cleaner source document."
];

checkHealth();
updatePromptChips();

uploadButton.addEventListener("click", openFilePicker);
composerUploadButton.addEventListener("click", openFilePicker);
sidebarOpenButton.addEventListener("click", openSidebar);
sidebarCloseButton.addEventListener("click", () => closeSidebar(true));
sidebarOverlay.addEventListener("click", () => closeSidebar(true));

function openFilePicker() {
  if (!busy) {
    fileInput.click();
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) {
    return;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    showNotice("File is too large for this Vercel demo. Please upload a file under 4 MB.", "error");
    setPolly("That file is too large for the hosted demo. Try a smaller PDF, TXT, or CSV.", "Too large", "error");
    fileInput.value = "";
    return;
  }

  await uploadDocument(file);
  fileInput.value = "";
});

clearButton.addEventListener("click", () => {
  chatMessages.innerHTML = initialMessage;
  hideNotice();
  updatePromptChips();
  setPolly("New chat started. Indexed documents stay ready in the sidebar.", "New chat", "idle");
  closeSidebar();
  questionInput.focus();
});

pollyButton.addEventListener("click", showNextPollyTip);
chatMessages.addEventListener("click", handlePromptClick);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("rag-sidebar-open")) {
    closeSidebar(true);
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question || busy) {
    return;
  }

  questionInput.value = "";
  appendMessage("user", question);
  await askQuestion(question);
});

async function checkHealth() {
  try {
    const response = await fetch(apiUrl("/api/health"));
    if (!response.ok) {
      throw new Error("Backend unavailable");
    }
    const data = await response.json();
    statusDot.className = "status-dot ready";

    if (!data.openai_configured || !data.database_configured) {
      statusText.textContent = "Backend connected, env vars missing";
      setPolly("The backend is online, but OpenAI or Neon env vars are not configured yet.", "Config needed", "error");
      return;
    }

    statusText.textContent = "Backend connected";
    setPolly("Backend connected. I will stay small and call out indexing, retrieval, and citations.", "Ready", "success");
  } catch {
    statusText.textContent = "Backend is not reachable";
    statusDot.className = "status-dot error";
    setPolly("The backend is not answering yet. Check the Vercel deployment or local FastAPI server.", "Backend offline", "error");
  }
}

async function uploadDocument(file) {
  setBusy(true, "Indexing...");
  showNotice(`Indexing ${file.name}. This may take a moment.`, "success");
  setPolly("Document received. The backend is extracting text, creating chunks, and storing embeddings.", "Indexing", "working");

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(apiUrl("/api/upload"), {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Upload failed.");
    }

    indexedDocuments.unshift(data);
    renderDocuments();
    updatePromptChips();
    showNotice(
      `${data.file_name} indexed successfully. ${data.chunks_created} chunks created.`,
      "success"
    );
    setPolly("Source map ready. Ask a question and open the source rows under the answer.", "Document indexed", "success");
    closeSidebar();
    questionInput.focus();
  } catch (error) {
    showNotice(error.message || "Upload failed while indexing the document.", "error");
    setPolly("That document could not be indexed. Check the file type, file contents, OpenAI key, or Neon database.", "Indexing failed", "error");
  } finally {
    setBusy(false);
  }
}

async function askQuestion(question) {
  setBusy(true, "Thinking...");
  const loadingMessage = appendMessage("assistant", "Searching indexed sources...");
  setPolly("The retriever is looking for the closest chunks before the answer is generated.", "Retrieving", "working");

  try {
    const response = await fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Chat failed.");
    }

    loadingMessage.remove();
    appendMessage("assistant", data.answer, data.sources);
    setPolly(
      data.sources?.length
        ? "Answer delivered with expandable source rows. That is the grounded RAG trail recruiters should see."
        : "No sources came back. Upload a document first or ask about indexed content.",
      data.sources?.length ? "Citations found" : "No citations",
      data.sources?.length ? "success" : "error"
    );
  } catch (error) {
    loadingMessage.remove();
    appendMessage("assistant", error.message || "Chat failed while generating an answer.");
    setPolly("The answer run failed. The most likely causes are API, embedding, or vector database trouble.", "Answer failed", "error");
  } finally {
    setBusy(false);
  }
}

function appendMessage(role, text, sources = []) {
  if (role === "user") {
    removeEmptyState();
  }

  const article = document.createElement("article");
  article.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "You" : "P";
  if (role === "assistant") {
    avatar.title = "Polly";
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const body = document.createElement("p");
  body.textContent = text;
  bubble.appendChild(body);

  if (sources.length > 0) {
    bubble.appendChild(renderSources(sources));
  }

  article.appendChild(avatar);
  article.appendChild(bubble);
  chatMessages.appendChild(article);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return article;
}

function removeEmptyState() {
  chatMessages.querySelector(".empty-state")?.remove();
}

function renderSources(sources) {
  const wrapper = document.createElement("section");
  wrapper.className = "sources";

  const heading = document.createElement("div");
  heading.className = "sources-heading";

  const title = document.createElement("h3");
  title.textContent = "Sources";

  const count = document.createElement("span");
  count.textContent = `${sources.length} found`;

  heading.appendChild(title);
  heading.appendChild(count);
  wrapper.appendChild(heading);

  const list = document.createElement("div");
  list.className = "source-list";

  sources.forEach((source, index) => {
    const item = document.createElement("details");
    item.className = "source-card";
    if (index === 0) {
      item.open = true;
    }

    const summary = document.createElement("summary");
    summary.className = "source-summary";

    const badge = document.createElement("span");
    badge.className = "source-badge";
    badge.textContent = String(index + 1);

    const sourceMeta = document.createElement("span");
    sourceMeta.className = "source-meta";

    const fileName = document.createElement("strong");
    fileName.textContent = source.file_name;
    fileName.title = source.file_name;

    const page = document.createElement("span");
    page.textContent = source.page ? `page ${source.page}` : "source";

    sourceMeta.appendChild(fileName);
    sourceMeta.appendChild(page);
    summary.appendChild(badge);
    summary.appendChild(sourceMeta);

    const preview = document.createElement("p");
    preview.className = "source-preview";
    preview.textContent = source.text_preview;

    item.appendChild(summary);
    item.appendChild(preview);
    list.appendChild(item);
  });

  wrapper.appendChild(list);
  return wrapper;
}

function renderDocuments() {
  documentCount.textContent = String(indexedDocuments.length);

  if (!indexedDocuments.length) {
    documentList.innerHTML = '<p class="empty-note">No documents uploaded yet.</p>';
    return;
  }

  documentList.innerHTML = "";
  indexedDocuments.forEach((indexedDocument, index) => {
    const item = document.createElement("article");
    item.className = "document-item";
    if (index === 0) {
      item.classList.add("active");
    }

    const name = document.createElement("strong");
    name.textContent = indexedDocument.file_name;
    name.title = indexedDocument.file_name;

    const meta = document.createElement("span");
    meta.textContent = `${indexedDocument.chunks_created} chunks - ${indexedDocument.documents_indexed} indexed`;

    item.appendChild(name);
    item.appendChild(meta);
    documentList.appendChild(item);
  });
}

async function handlePromptClick(event) {
  const chip = event.target.closest(".prompt-chip");
  if (!chip || chip.disabled || busy) {
    return;
  }

  const prompt = chip.dataset.prompt;
  if (!prompt) {
    return;
  }

  questionInput.value = "";
  appendMessage("user", prompt);
  await askQuestion(prompt);
}

function updatePromptChips() {
  const hasDocuments = indexedDocuments.length > 0;
  document.querySelectorAll(".prompt-chip").forEach((chip) => {
    chip.disabled = !hasDocuments || busy;
    chip.title = hasDocuments ? "" : "Upload a document first.";
  });
}

function openSidebar() {
  document.body.classList.add("rag-sidebar-open");
  sidebarOpenButton.setAttribute("aria-expanded", "true");
  sidebarOverlay.hidden = false;
  sidebarCloseButton.focus();
}

function closeSidebar(returnFocus = false) {
  document.body.classList.remove("rag-sidebar-open");
  sidebarOpenButton.setAttribute("aria-expanded", "false");
  sidebarOverlay.hidden = true;
  if (returnFocus) {
    sidebarOpenButton.focus();
  }
}

function showNextPollyTip() {
  const hasDocuments = indexedDocuments.length > 0;
  const tip = hasDocuments
    ? pollyTips[pollyTipIndex % pollyTips.length]
    : "No indexed documents yet. Upload a PDF, TXT, or CSV file and I will confirm when the source map is ready.";

  pollyTipIndex += 1;
  setPolly(tip, hasDocuments ? "Demo tip" : "Waiting for upload", hasDocuments ? "idle" : "error");
}

function setPolly(message, status, mood) {
  pollyText.textContent = message;
  pollyStatus.textContent = status;
  pollyCard.dataset.mood = mood;
  pollyCard.classList.remove("polly-pulse");
  void pollyCard.offsetWidth;
  pollyCard.classList.add("polly-pulse");
}

function showNotice(message, type) {
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
}

function setBusy(nextBusy, label = "Send") {
  busy = nextBusy;
  uploadButton.disabled = busy;
  composerUploadButton.disabled = busy;
  sendButton.disabled = busy;
  questionInput.disabled = busy;
  chatForm.dataset.busy = String(nextBusy);
  chatForm.setAttribute("aria-busy", String(nextBusy));
  chatMessages.setAttribute("aria-busy", String(nextBusy));
  questionInput.placeholder = nextBusy ? label : initialPlaceholder;
  sendButton.textContent = nextBusy ? label : "Send";
  updatePromptChips();
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}
