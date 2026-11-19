
/* =========================================
   RECALL — MAIN APPLICATION
========================================= */

const $ = (id) => document.getElementById(id);

const DB_NAME = "RecallDatabase";
const DB_VERSION = 1;
const STORE_NAME = "materials";

let db;
let currentUser = null;
let materials = [];
let flashcards = [];
let quizHistory = [];

let activeCards = [];
let cardIndex = 0;
let cardFlipped = false;

let activeQuiz = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;

let selectedStudyMode = "both";
let selectedMaterialIds = [];

/* =========================================
   STORAGE HELPERS
========================================= */

function storageKey(name) {
  return `recall_${currentUser.id}_${name}`;
}

function readData(name, fallback = []) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(name))) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveData(name, data) {
  localStorage.setItem(storageKey(name), JSON.stringify(data));
}

function createId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* =========================================
   AUTHENTICATION
========================================= */

function getUsers() {
  return JSON.parse(localStorage.getItem("recall_users") || "[]");
}

function saveUsers(users) {
  localStorage.setItem("recall_users", JSON.stringify(users));
}

function showLogin() {
  $("loginPanel").classList.remove("hidden");
  $("registerPanel").classList.add("hidden");
  $("authMessage").textContent = "";
}

function showRegister() {
  $("loginPanel").classList.add("hidden");
  $("registerPanel").classList.remove("hidden");
  $("authMessage").textContent = "";
}

$("showRegister").addEventListener("click", showRegister);
$("showLogin").addEventListener("click", showLogin);

$("registerForm").addEventListener("submit", event => {
  event.preventDefault();

  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim().toLowerCase();
  const password = $("registerPassword").value;
  const confirm = $("confirmPassword").value;

  if (password.length < 6) {
    return showAuthMessage("Password must contain at least 6 characters.", "error");
  }

  if (password !== confirm) {
    return showAuthMessage("Passwords do not match.", "error");
  }

  const users = getUsers();

  if (users.some(user => user.email === email)) {
    return showAuthMessage("An account with this email already exists.", "error");
  }

  const user = {
    id: createId(),
    name,
    email,
    password
  };

  users.push(user);
  saveUsers(users);

  enterRecall(user);
  $("registerForm").reset();
});

$("loginForm").addEventListener("submit", event => {
  event.preventDefault();

  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value;

  const user = getUsers().find(
    item => item.email === email && item.password === password
  );

  if (!user) {
    return showAuthMessage("Incorrect email or password.", "error");
  }

  enterRecall(user);
  $("loginForm").reset();
});

function showAuthMessage(message, type) {
  $("authMessage").textContent = message;
  $("authMessage").className = `message ${type}`;
}

function enterRecall(user) {
  currentUser = user;
  localStorage.setItem("recall_session", user.id);

  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");

  $("sidebarUser").textContent = user.name;
  $("userAvatar").textContent = user.name.charAt(0).toUpperCase();
  $("welcomeName").textContent = `Welcome back, ${user.name.split(" ")[0]}!`;

  initializeRecall();
  openPage("dashboard");
}

$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("recall_session");
  currentUser = null;
  $("app").classList.add("hidden");
  $("authScreen").classList.remove("hidden");
  showLogin();
});

function checkSession() {
  const sessionId = localStorage.getItem("recall_session");
  const user = getUsers().find(item => item.id === sessionId);

  if (user) {
    enterRecall(user);
  } else {
    localStorage.removeItem("recall_session");
    $("authScreen").classList.remove("hidden");
    $("app").classList.add("hidden");
  }
}

/* =========================================
   INDEXEDDB
========================================= */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = event => resolve(event.target.result);
    request.onerror = () => reject(request.error);
  });
}

function dbRequest(mode, action, data) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    let request;

    if (action === "getAll") request = store.getAll();
    if (action === "put") request = store.put(data);
    if (action === "delete") request = store.delete(data);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function initializeRecall() {
  if (!db) {
    try {
      db = await openDatabase();
    } catch (error) {
      alert("Unable to open local database. Please use a modern browser.");
      return;
    }
  }

  flashcards = readData("flashcards");
  quizHistory = readData("quizHistory");

  const allMaterials = await dbRequest("readonly", "getAll");

  materials = allMaterials.filter(
    item => item.userId === currentUser.id
  );

  renderDashboard();
  renderMaterials();
  updateStudySources();
  renderFlashcardSource();
  renderQuizSource();
  renderProgress();
}

/* =========================================
   NAVIGATION
========================================= */

const pageNames = {
  dashboard: "Dashboard",
  materials: "My Materials",
  study: "Study Session",
  flashcards: "Flashcards",
  quiz: "Quiz",
  progress: "My Progress"
};

function openPage(page) {
  document.querySelectorAll(".page").forEach(section => {
    section.classList.remove("active-page");
  });

  const target = $(`${page}Page`);
  if (!target) return;

  target.classList.add("active-page");
  $("pageHeading").textContent = pageNames[page] || "Recall";

  document.querySelectorAll(".nav-link").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  if (page === "dashboard") renderDashboard();
  if (page === "materials") renderMaterials();
  if (page === "progress") renderProgress();
  if (page === "flashcards") renderFlashcards();
  if (page === "quiz") renderQuizPage();
}

document.querySelectorAll(".nav-link").forEach(button => {
  button.addEventListener("click", () => openPage(button.dataset.page));
});

document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => openPage(button.dataset.go));
});

$("topUploadBtn").addEventListener("click", () => openPage("materials"));

/* =========================================
   FILE UPLOAD
========================================= */

$("browseBtn").addEventListener("click", () => $("fileInput").click());

$("fileInput").addEventListener("change", async event => {
  await handleFiles(event.target.files);
  event.target.value = "";
});

const dropZone = $("dropZone");

dropZone.addEventListener("dragover", event => {
  event.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", async event => {
  event.preventDefault();
  dropZone.classList.remove("dragover");
  await handleFiles(event.dataTransfer.files);
});

async function handleFiles(fileList) {
  const files = Array.from(fileList);

  if (!files.length) return;

  for (const file of files) {
    const extension = file.name.split(".").pop().toLowerCase();

    if (!["pdf", "pptx", "docx", "txt"].includes(extension)) {
      setUploadMessage(`${file.name}: Unsupported file type.`, "error");
      continue;
    }

    if (file.size > 20 * 1024 * 1024) {
      setUploadMessage(`${file.name}: File exceeds the 20 MB limit.`, "error");
      continue;
    }

    setUploadMessage(`Reading ${file.name}...`, "");

    try {
      const text = await extractFileText(file, extension);

      if (!text.trim()) {
        throw new Error("No readable text was found in this file.");
      }

      const material = {
        id: createId(),
        userId: currentUser.id,
        name: file.name,
        type: extension.toUpperCase(),
        size: file.size,
        date: new Date().toISOString(),
        text: cleanText(text)
      };

      await dbRequest("readwrite", "put", material);
      materials.push(material);

      setUploadMessage(`${file.name} uploaded successfully.`, "success");
    } catch (error) {
      console.error(error);
      setUploadMessage(`${file.name}: ${error.message}`, "error");
    }
  }

  renderMaterials();
  renderDashboard();
  updateStudySources();
  renderFlashcardSource();
  renderQuizSource();
}

function setUploadMessage(message, type) {
  $("uploadStatus").textContent = message;
  $("uploadStatus").className = `message ${type}`;
}

async function extractFileText(file, extension) {
  if (extension === "txt") {
    return await file.text();
  }

  if (extension === "pdf") {
    if (!window.pdfjsLib) throw new Error("PDF reader library is unavailable.");

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    let result = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      result += content.items.map(item => item.str).join(" ") + "\n";
    }

    return result;
  }

  if (extension === "docx") {
    if (!window.mammoth) throw new Error("DOCX reader library is unavailable.");

    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  if (extension === "pptx") {
    if (!window.JSZip) throw new Error("PPTX reader library is unavailable.");

    const zip = await JSZip.loadAsync(file);
    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = Number(a.match(/slide(\d+)/)[1]);
        const numB = Number(b.match(/slide(\d+)/)[1]);
        return numA - numB;
      });

    let result = "";

    for (const slide of slideFiles) {
      const xml = await zip.files[slide].async("text");
      const documentXML = new DOMParser().parseFromString(xml, "text/xml");

      const texts = Array.from(documentXML.getElementsByTagName("a:t"))
        .map(node => node.textContent)
        .filter(Boolean);

      result += texts.join(" ") + "\n";
    }

    return result;
  }

  throw new Error("Unsupported file format.");
}

function cleanText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================================
   MATERIALS DISPLAY
========================================= */

function renderMaterials() {
  $("moduleCount").textContent = `${materials.length} modules`;

  if (!materials.length) {
    $("materialsList").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">▤</div>
        <h2>No materials uploaded</h2>
        <p>Upload your first module to start creating study activities.</p>
      </div>`;
    return;
  }

  $("materialsList").innerHTML = materials
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(material => `
      <div class="material-item">
        <div class="file-icon">${escapeHTML(material.type)}</div>
        <div class="material-details">
          <strong>${escapeHTML(material.name)}</strong>
          <small>${formatSize(material.size)} · Uploaded ${formatDate(material.date)}</small>
          <small>${material.text.length.toLocaleString()} extracted characters</small>
        </div>
        <div class="material-actions">
          <button class="small-action" data-generate="${material.id}">Generate</button>
          <button class="small-action delete-action" data-delete="${material.id}">Delete</button>
        </div>
      </div>
    `).join("");

  document.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", () => deleteMaterial(button.dataset.delete));
  });

  document.querySelectorAll("[data-generate]").forEach(button => {
    button.addEventListener("click", () => {
      selectedMaterialIds = [button.dataset.generate];
      document.querySelector('input[name="sourceMode"][value="specific"]').checked = true;
      updateStudySources();
      openPage("study");
      updateSessionSummary();
    });
  });
}

async function deleteMaterial(id) {
  const material = materials.find(item => item.id === id);
  if (!material) return;

  if (!confirm(`Delete "${material.name}" and its generated study content?`)) return;

  await dbRequest("readwrite", "delete", id);

  materials = materials.filter(item => item.id !== id);
  flashcards = flashcards.filter(card => card.materialId !== id);
  quizHistory = quizHistory.filter(item => !item.materialIds?.includes(id));

  saveData("flashcards", flashcards);
  saveData("quizHistory", quizHistory);

  renderMaterials();
  renderDashboard();
  renderProgress();
  updateStudySources();
  renderFlashcardSource();
  renderQuizSource();
}

/* =========================================
   DASHBOARD
========================================= */

function renderDashboard() {
  $("statMaterials").textContent = materials.length;
  $("statCards").textContent = flashcards.length;
  $("statMastered").textContent = flashcards.filter(card => card.known).length;
  $("statQuizzes").textContent = quizHistory.length;

  const recent = materials.slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4);

  if (!recent.length) {
    $("recentMaterials").innerHTML = `
      <div class="empty-state">
        <p>You haven't uploaded any materials yet.</p>
        <button class="primary-btn" data-go="materials">Upload Material</button>
      </div>`;

    $("recentMaterials").querySelector("[data-go]")
      ?.addEventListener("click", () => openPage("materials"));
    return;
  }

  $("recentMaterials").innerHTML = recent.map(material => `
    <div class="material-item">
      <div class="file-icon">${escapeHTML(material.type)}</div>
      <div class="material-details">
        <strong>${escapeHTML(material.name)}</strong>
        <small>Uploaded ${formatDate(material.date)}</small>
      </div>
    </div>
  `).join("");
}

/* =========================================
   STUDY SOURCE SELECTION
========================================= */

document.querySelectorAll('input[name="studyMode"]').forEach(input => {
  input.addEventListener("change", () => {
    selectedStudyMode = input.value;

    document.querySelectorAll(".mode-option").forEach(option => {
      option.classList.toggle(
        "selected",
        option.querySelector("input").checked
      );
    });

    updateSessionSummary();
  });
});

document.querySelectorAll('input[name="sourceMode"]').forEach(input => {
  input.addEventListener("change", () => {
    updateStudySources();
    updateSessionSummary();
  });
});

function updateStudySources() {
  const specific = document.querySelector('input[name="sourceMode"]:checked').value === "specific";

  $("moduleSelector").classList.toggle("hidden", !specific);

  $("moduleCheckboxes").innerHTML = materials.length
    ? materials.map(material => `
      <label class="module-check">
        <input type="checkbox" value="${material.id}"
          ${selectedMaterialIds.includes(material.id) ? "checked" : ""}>
        <span>${escapeHTML(material.name)}</span>
      </label>
    `).join("")
    : `<p class="muted">Upload materials first to select modules.</p>`;

  $("moduleCheckboxes").querySelectorAll("input").forEach(input => {
    input.addEventListener("change", () => {
      selectedMaterialIds = Array.from(
        $("moduleCheckboxes").querySelectorAll("input:checked")
      ).map(item => item.value);

      updateSessionSummary();
    });
  });
}

function getSelectedMaterials() {
  const sourceMode = document.querySelector('input[name="sourceMode"]:checked').value;

  if (sourceMode === "all") return materials;

  return materials.filter(material =>
    selectedMaterialIds.includes(material.id)
  );
}

function updateSessionSummary() {
  const mode = document.querySelector('input[name="studyMode"]:checked').value;
  const selected = getSelectedMaterials();

  const modeText = {
    flashcards: "flashcards only",
    quiz: "a quiz only",
    both: "flashcards followed by a quiz"
  }[mode];

  const sourceText =
    document.querySelector('input[name="sourceMode"]:checked').value === "all"
      ? "all uploaded modules"
      : `${selected.length} selected module(s)`;

  $("sessionSummary").textContent =
    `Your study session will include ${modeText} using ${sourceText}.`;
}

$("beginStudyBtn").addEventListener("click", () => {
  const selected = getSelectedMaterials();

  if (!materials.length) {
    alert("Please upload at least one study material first.");
    return;
  }

  if (!selected.length) {
    alert("Please select at least one module.");
    return;
  }

  selectedStudyMode = document.querySelector(
    'input[name="studyMode"]:checked'
  ).value;

  const generatedCards = selected.flatMap(material =>
    generateFlashcards(material)
  );

  const generatedQuestions = selected.flatMap(material =>
    generateQuestions(material)
  );

  if (selectedStudyMode !== "quiz" && !generatedCards.length) {
    alert("Not enough readable content to create flashcards. Try another file.");
    return;
  }

  if (selectedStudyMode !== "flashcards" && !generatedQuestions.length) {
    alert("Not enough readable content to create quiz questions. Try another file.");
    return;
  }

  const selectedIds = selected.map(item => item.id);

  // Replace generated cards for the selected materials.
  flashcards = flashcards.filter(
    card => !selectedIds.includes(card.materialId)
  );

  flashcards.push(...generatedCards);
  saveData("flashcards", flashcards);

  activeCards = generatedCards;
  activeQuiz = generatedQuestions;

  if (selectedStudyMode === "flashcards" || selectedStudyMode === "both") {
    cardIndex = 0;
    cardFlipped = false;
    openPage("flashcards");
    renderFlashcards();
  } else {
    startQuiz(generatedQuestions);
    openPage("quiz");
  }

  renderDashboard();
  renderProgress();
});

/* =========================================
   CONTENT PROCESSING
========================================= */

function getSentences(text) {
  return text
    .replace(/([.!?])\s+/g, "$1|")
    .split("|")
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 35 && sentence.length <= 350);
}

function generateFlashcards(material) {
  const sentences = getSentences(material.text);
  const cards = [];
  const used = new Set();

  for (const sentence of sentences) {
    if (cards.length >= 40) break;

    const words = sentence.split(/\s+/);
    const important = words.find(word =>
      word.length >= 7 &&
      /^[A-Z][a-zA-Z-]+$/.test(word) &&
      !["However", "Therefore", "Because", "Although", "Through"].includes(word)
    );

    let question = "";
    let answer = sentence;

    if (important) {
      const escaped = important.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");

      question = `What does the material explain about "${important}"?`;
      answer = sentence.replace(regex, important);
    } else {
      const firstWords = words.slice(0, 7).join(" ");
      question = `Explain the concept: "${firstWords}..."`;
    }

    const key = question.toLowerCase();

    if (used.has(key)) continue;
    used.add(key);

    cards.push({
      id: createId(),
      materialId: material.id,
      materialName: material.name,
      question,
      answer,
      known: false
    });
  }

  return cards;
}

function generateQuestions(material) {
  const sentences = getSentences(material.text);
  const questions = [];
  const used = new Set();

  const terms = sentences.map(sentence => {
    const words = sentence.split(/\s+/);
    const term = words.find(word =>
      word.length >= 7 &&
      /^[A-Z][a-zA-Z-]+$/.test(word) &&
      !["However", "Therefore", "Because", "Although", "Through"].includes(word)
    );

    return { sentence, term };
  }).filter(item => item.term);

  for (const item of terms) {
    if (questions.length >= 30) break;

    const key = item.term.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);

    const wrongTerms = terms
      .filter(other => other.term.toLowerCase() !== key)
      .map(other => other.term);

    const uniqueWrong = [...new Set(wrongTerms)].slice(0, 3);

    if (uniqueWrong.length < 2) continue;

    const choices = shuffle([
      item.term,
      ...uniqueWrong.slice(0, 3)
    ]);

    questions.push({
      id: createId(),
      materialId: material.id,
      materialName: material.name,
      question: `According to the uploaded material, which term is discussed in this statement?\n\n"${item.sentence}"`,
      choices,
      answer: item.term
    });
  }

  // Fallback for materials without enough capitalized terms.
  if (questions.length < 3 && sentences.length >= 3) {
    sentences.slice(0, 10).forEach((sentence, index) => {
      if (questions.length >= 10) return;

      const answer = sentence.length > 130
        ? sentence.slice(0, 127).trim() + "..."
        : sentence;

      const distractors = sentences
        .filter((_, i) => i !== index)
        .slice(0, 3)
        .map(text => text.length > 130 ? text.slice(0, 127).trim() + "..." : text);

      if (distractors.length < 2) return;

      questions.push({
        id: createId(),
        materialId: material.id,
        materialName: material.name,
        question: "Which statement appears in the uploaded material?",
        choices: shuffle([answer, ...distractors]),
        answer
      });
    });
  }

  return questions;
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/* =========================================
   FLASHCARDS
========================================= */

function renderFlashcardSource() {
  const select = $("flashcardSource");
  const previous = select.value;

  select.innerHTML = `<option value="all">All modules</option>` +
    materials.map(material =>
      `<option value="${material.id}">${escapeHTML(material.name)}</option>`
    ).join("");

  if ([...select.options].some(option => option.value === previous)) {
    select.value = previous;
  }
}

$("flashcardSource").addEventListener("change", () => {
  renderFlashcards();
});

function getCardsForSource() {
  const source = $("flashcardSource").value;

  return flashcards.filter(card =>
    source === "all" || card.materialId === source
  );
}

function renderFlashcards() {
  activeCards = getCardsForSource();

  const hasCards = activeCards.length > 0;

  $("flashcardEmpty").classList.toggle("hidden", hasCards);
  $("flashcardArea").classList.toggle("hidden", !hasCards);

  if (!hasCards) {
    $("flashcardCounter").textContent = "0 / 0";
    return;
  }

  cardIndex = Math.min(cardIndex, activeCards.length - 1);
  showFlashcard();
}

function showFlashcard() {
  if (!activeCards.length) return;

  const card = activeCards[cardIndex];
  const text = cardFlipped ? card.answer : card.question;

  $("flashcardText").textContent = text;
  $("flashcardSide").textContent = cardFlipped ? "ANSWER" : "QUESTION";
  $("flashcardCounter").textContent = `${cardIndex + 1} / ${activeCards.length}`;
  $("flashcardSourceName").textContent = card.materialName || "";

  $("flashcard").classList.toggle("flipped", cardFlipped);
}

function flipFlashcard() {
  cardFlipped = !cardFlipped;
  showFlashcard();
}

$("flashcard").addEventListener("click", flipFlashcard);
$("flipCard").addEventListener("click", flipFlashcard);

$("previousCard").addEventListener("click", () => {
  if (!activeCards.length) return;
  cardIndex = (cardIndex - 1 + activeCards.length) % activeCards.length;
  cardFlipped = false;
  showFlashcard();
});

$("nextCard").addEventListener("click", () => {
  if (!activeCards.length) return;

  if (cardIndex < activeCards.length - 1) {
    cardIndex++;
  } else {
    cardIndex = 0;
  }

  cardFlipped = false;
  showFlashcard();
});

function updateCardStatus(known) {
  const card = activeCards[cardIndex];
  if (!card) return;

  const original = flashcards.find(item => item.id === card.id);

  if (original) {
    original.known = known;
    saveData("flashcards", flashcards);
  }

  activeCards[cardIndex] = { ...card, known };

  renderDashboard();
  renderProgress();

  if (cardIndex < activeCards.length - 1) {
    cardIndex++;
    cardFlipped = false;
    showFlashcard();
  } else {
    showFlashcard();
  }
}

$("knownCard").addEventListener("click", () => updateCardStatus(true));
$("reviewCard").addEventListener("click", () => updateCardStatus(false));

/* =========================================
   QUIZ
========================================= */

function renderQuizSource() {
  const select = $("quizSource");
  const previous = select.value;

  select.innerHTML = `<option value="all">All modules</option>` +
    materials.map(material =>
      `<option value="${material.id}">${escapeHTML(material.name)}</option>`
    ).join("");

  if ([...select.options].some(option => option.value === previous)) {
    select.value = previous;
  }
}

$("quizSource").addEventListener("change", () => {
  activeQuiz = [];
  renderQuizPage();
});

function renderQuizPage() {
  $("quizEmpty").classList.remove("hidden");
  $("quizArea").classList.add("hidden");
  $("quizResult").classList.add("hidden");

  const source = $("quizSource").value;
  const cards = quizHistory.length;

  const hasGeneratedQuiz = activeQuiz.length > 0;

  if (hasGeneratedQuiz) {
    $("quizEmpty").classList.add("hidden");
    $("quizArea").classList.remove("hidden");
    return;
  }

  if (!cards && !materials.length) {
    $("quizEmpty").classList.remove("hidden");
  }
}

function startQuiz(questions) {
  activeQuiz = questions.map(question => ({ ...question }));
  quizIndex = 0;
  quizScore = 0;
  quizAnswered = false;

  $("quizResult").classList.add("hidden");
  $("quizEmpty").classList.toggle("hidden", activeQuiz.length > 0);
  $("quizArea").classList.toggle("hidden", activeQuiz.length === 0);

  if (activeQuiz.length) showQuestion();
}

function showQuestion() {
  const question = activeQuiz[quizIndex];
  if (!question) return;

  quizAnswered = false;

  $("quizCounter").textContent =
    `Question ${quizIndex + 1} of ${activeQuiz.length}`;

  $("quizScoreLabel").textContent = `Score: ${quizScore}`;

  $("quizProgressBar").style.width =
    `${(quizIndex / activeQuiz.length) * 100}%`;

  $("quizQuestion").textContent = question.question;
  $("quizFeedback").textContent = "";
  $("quizFeedback").className = "quiz-feedback";

  $("nextQuestionBtn").disabled = true;
  $("nextQuestionBtn").textContent =
    quizIndex === activeQuiz.length - 1 ? "Finish Quiz" : "Next Question →";

  $("quizChoices").innerHTML = question.choices.map((choice, index) => `
    <button class="quiz-choice" data-choice="${index}">
      ${String.fromCharCode(65 + index)}. ${escapeHTML(choice)}
    </button>
  `).join("");

  $("quizChoices").querySelectorAll(".quiz-choice").forEach(button => {
    button.addEventListener("click", () => {
      answerQuestion(Number(button.dataset.choice));
    });
  });
}

function answerQuestion(choiceIndex) {
  if (quizAnswered) return;

  quizAnswered = true;

  const question = activeQuiz[quizIndex];
  const selected = question.choices[choiceIndex];
  const correct = selected === question.answer;

  if (correct) quizScore++;

  $("quizChoices").querySelectorAll(".quiz-choice").forEach((button, index) => {
    button.disabled = true;

    const value = question.choices[index];

    if (value === question.answer) {
      button.classList.add("correct");
    } else if (index === choiceIndex) {
      button.classList.add("wrong");
    }
  });

  $("quizFeedback").textContent = correct
    ? "Correct! Great job."
    : `Not quite. Correct answer: ${question.answer}`;

  $("quizFeedback").className =
    `quiz-feedback ${correct ? "good" : "bad"}`;

  $("quizScoreLabel").textContent = `Score: ${quizScore}`;
  $("nextQuestionBtn").disabled = false;
}

$("nextQuestionBtn").addEventListener("click", () => {
  if (!quizAnswered) return;

  if (quizIndex < activeQuiz.length - 1) {
    quizIndex++;
    showQuestion();
  } else {
    finishQuiz();
  }
});

function finishQuiz() {
  const total = activeQuiz.length;
  const percentage = total ? Math.round((quizScore / total) * 100) : 0;

  $("quizArea").classList.add("hidden");
  $("quizResult").classList.remove("hidden");

  $("finalScore").textContent = `${quizScore} / ${total}`;
  $("finalPercentage").textContent = `${percentage}% correct answers`;

  const materialIds = [
    ...new Set(activeQuiz.map(question => question.materialId))
  ];

  quizHistory.unshift({
    id: createId(),
    score: quizScore,
    total,
    percentage,
    materialIds,
    date: new Date().toISOString()
  });

  saveData("quizHistory", quizHistory);

  renderDashboard();
  renderProgress();

  if (selectedStudyMode === "both") {
    $("quizResult").querySelector(".result-card");
  }
}

$("retryQuizBtn").addEventListener("click", () => {
  startQuiz(activeQuiz);
});

/* =========================================
   PROGRESS
========================================= */

function renderProgress() {
  const mastered = flashcards.filter(card => card.known).length;

  const average = quizHistory.length
    ? Math.round(
        quizHistory.reduce((sum, item) => sum + item.percentage, 0) /
        quizHistory.length
      )
    : 0;

  $("progressMaterials").textContent = materials.length;
  $("progressMastered").textContent = mastered;
  $("progressQuizzes").textContent = quizHistory.length;
  $("progressAverage").textContent = `${average}%`;

  if (!quizHistory.length) {
    $("quizHistory").innerHTML = `
      <div class="empty-state">
        <p>No quiz results yet. Complete a quiz to see your progress.</p>
      </div>`;
    return;
  }

  $("quizHistory").innerHTML = quizHistory.map(item => `
    <div class="history-item">
      <div>
        <strong>Study Quiz</strong>
        <small>${formatDate(item.date)} · ${item.total} questions</small>
      </div>
      <div class="history-score">
        ${item.score}/${item.total}
        <small>${item.percentage}%</small>
      </div>
    </div>
  `).join("");
}

/* =========================================
   INITIAL STARTUP
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  checkSession();
});
