const API_BASE_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const fileInput = document.querySelector("#fileInput");
const uploadButton = document.querySelector("#uploadButton");
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
const pollyTips = [
  "Upload a document first. Once it is indexed, questions will use retrieved chunks instead of guessing.",
  "Good demo questions are specific: ask about a policy, date, responsibility, benefit, or project detail from the uploaded file.",
  "Source scrolls are the trust signal. They show which file and page supported the answer.",
  "If an answer feels off, ask a narrower question or upload a cleaner source document."
];

checkHealth();

uploadButton.addEventListener("click", () => {
  if (!busy) {
    fileInput.click();
  }
});

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
  setPolly("Upload the first document and I will keep watch while the RAG engine builds its source map.", "Standing by", "idle");
  questionInput.focus();
});

pollyButton.addEventListener("click", showNextPollyTip);

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
    setPolly("Backend connected. Upload a document and I will track the RAG flow from indexing to citations.", "Ready", "success");
  } catch {
    statusText.textContent = "Backend is not reachable";
    statusDot.className = "status-dot error";
    setPolly("The backend is not answering yet. Check the Vercel deployment or local FastAPI server.", "Backend offline", "error");
  }
}

async function uploadDocument(file) {
  setBusy(true, "Indexing...");
  showNotice(`Indexing ${file.name}. This may take a moment.`, "success");
  setPolly("I found fresh cargo. The backend is extracting text, creating chunks, and storing embeddings.", "Indexing", "working");

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
    showNotice(
      `${data.file_name} indexed successfully. ${data.chunks_created} chunks created.`,
      "success"
    );
    setPolly("Source map ready. Ask a question and check the citations under the answer.", "Source map ready", "success");
  } catch (error) {
    showNotice(error.message || "Upload failed while indexing the document.", "error");
    setPolly("That document could not be indexed. Check the file type, file contents, OpenAI key, or Neon database.", "Indexing failed", "error");
  } finally {
    setBusy(false);
  }
}

async function askQuestion(question) {
  setBusy(true, "Thinking...");
  const loadingMessage = appendMessage("assistant", "Searching indexed source scrolls...");
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
        ? "Answer delivered with source scrolls. That is the grounded RAG trail recruiters should see."
        : "No source scrolls came back. Upload a document first or ask about indexed content.",
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
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "You" : "AI";

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

function renderSources(sources) {
  const wrapper = document.createElement("section");
  wrapper.className = "sources";

  const heading = document.createElement("h3");
  heading.textContent = "Source Scrolls";
  wrapper.appendChild(heading);

  const list = document.createElement("div");
  list.className = "source-list";

  sources.forEach((source, index) => {
    const item = document.createElement("article");
    item.className = "source-card";

    const title = document.createElement("strong");
    const page = source.page ? ` - page ${source.page}` : "";
    title.textContent = `Source ${index + 1}: ${source.file_name}${page}`;

    const preview = document.createElement("p");
    preview.textContent = source.text_preview;

    item.appendChild(title);
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
  indexedDocuments.forEach((indexedDocument) => {
    const item = document.createElement("article");
    item.className = "document-item";

    const name = document.createElement("strong");
    name.textContent = indexedDocument.file_name;

    const meta = document.createElement("span");
    meta.textContent = `${indexedDocument.chunks_created} chunks - ${indexedDocument.documents_indexed} indexed`;

    item.appendChild(name);
    item.appendChild(meta);
    documentList.appendChild(item);
  });
}

function showNextPollyTip() {
  const hasDocuments = indexedDocuments.length > 0;
  const tip = hasDocuments
    ? pollyTips[pollyTipIndex % pollyTips.length]
    : "No indexed cargo yet. Upload a PDF, TXT, or CSV file and I will confirm when the source map is ready.";

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
  sendButton.disabled = busy;
  questionInput.disabled = busy;
  sendButton.textContent = nextBusy ? label : "Send";
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}
