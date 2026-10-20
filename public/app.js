const SUBJECTS = ["Bangla", "English", "ICT", "Economics", "History", "Civics", "Geography"];
const state = { user: null, today: "", date: "", subject: "all", query: "", notes: [], authMode: "login" };
const $ = (selector) => document.querySelector(selector);
const datePicker = $("#date-picker");
const subjectPicker = $("#subject-picker");
const notesGrid = $("#notes-grid");
let searchTimer;
let toastTimer;
let photoPreviewUrls = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function dateFromIso(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shortDate(iso) {
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(dateFromIso(iso));
}

function prettyDate(iso) {
  const value = dateFromIso(iso);
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(value);
}

function dateForNote(iso) {
  if (iso === state.today) return "Today";
  const yesterday = dateFromIso(state.today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === localIso(yesterday)) return "Yesterday";
  return shortDate(iso);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...options.headers },
  });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3400);
}

function setBusy(button, isBusy, label) {
  button.disabled = isBusy;
  if (isBusy) {
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `<span class="spinner"></span>${escapeHtml(label)}`;
  } else if (button.dataset.originalText) {
    button.innerHTML = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

function renderUser() {
  const area = $("#user-area");
  if (!state.user) {
    area.innerHTML = "";
    $("#auth-open").classList.remove("is-hidden");
    $("#header-upload").classList.remove("is-hidden");
    return;
  }
  $("#auth-open").classList.add("is-hidden");
  area.innerHTML = `
    <span class="user-avatar" aria-hidden="true">${escapeHtml(state.user.name.slice(0, 1).toUpperCase())}</span>
    <span class="user-name">${escapeHtml(state.user.name.split(" ")[0])}</span>
    <button class="sign-out-button" id="sign-out" type="button">Sign out</button>`;
  $("#sign-out").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      state.user = null;
      renderUser();
      await loadNotes();
      showToast("You’re signed out. Thanks for studying with us.");
    } catch (error) {
      showToast(error.message);
    }
  });
}

function renderDatePicker() {
  const today = dateFromIso(state.today);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - index));
    return localIso(date);
  });
  datePicker.innerHTML = dates.map((date) => {
    const selected = state.date === date;
    const label = date === state.today ? "Today" : shortDate(date).split(",")[0];
    const day = dateFromIso(date).getDate();
    return `<button class="date-chip${selected ? " active" : ""}" data-date="${date}" type="button" aria-pressed="${selected}">
      <span>${label}</span><strong>${day}</strong></button>`;
  }).join("");
  datePicker.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.date = button.dataset.date;
      $("#all-dates").classList.remove("active");
      renderDatePicker();
      updateResultsTitle();
      loadNotes();
    });
  });
  $("#all-dates").classList.toggle("active", state.date === "all");
}

function renderSubjectPicker() {
  subjectPicker.innerHTML = [
    `<button class="subject-chip${state.subject === "all" ? " active" : ""}" type="button" data-subject="all">All subjects</button>`,
    ...SUBJECTS.map((subject) => `
      <button class="subject-chip subject-${subject.toLowerCase()}${state.subject === subject ? " active" : ""}" type="button" data-subject="${subject}">
        <span class="subject-dot dot-${subject.toLowerCase()}"></span>${subject}</button>`),
  ].join("");
  subjectPicker.querySelectorAll("[data-subject]").forEach((button) => {
    button.addEventListener("click", () => {
      state.subject = button.dataset.subject;
      renderSubjectPicker();
      updateResultsTitle();
      loadNotes();
    });
  });
}

function updateResultsTitle() {
  const day = state.date === "all" ? "All days" : state.date === state.today ? "Today" : prettyDate(state.date);
  const subject = state.subject === "all" ? "" : ` · ${state.subject}`;
  $("#results-title").textContent = state.query
    ? `Search results${subject}`
    : `${day}’s class notes${subject}`;
  $("#results-subtitle").textContent = state.date === "all" && state.subject === "all"
    ? "Notes shared by your classmates, all together."
    : "A shared notebook, ready when you are.";
}

function noteCard(note) {
  const owner = state.user && Number(note.uploader_id) === Number(state.user.id) && !note.is_sample;
  return `<article class="note-card">
    <button class="note-photo-button" type="button" data-note-open="${note.id}" aria-label="Open photo: ${escapeHtml(note.title)}">
      <img class="note-photo" src="/api/notes/${note.id}/image" alt="Photo of ${escapeHtml(note.title)} class notes" loading="lazy" />
      <span class="photo-badge">${escapeHtml(note.subject)}</span>
      ${note.photo_count > 1 ? `<span class="sample-badge photo-count-badge">${note.photo_count} PHOTOS</span>` : ""}
      ${note.is_sample ? `<span class="sample-badge">SAMPLE NOTE</span>` : ""}
      <span class="photo-view" aria-hidden="true">View photo ↗</span>
    </button>
    <div class="note-card-body">
      <div class="note-card-meta"><span>${escapeHtml(dateForNote(note.lesson_date))}</span><span class="meta-dot">·</span><span>Shared by ${escapeHtml(note.author_name)}</span></div>
      <h4>${escapeHtml(note.title)}</h4>
      ${note.caption ? `<p>${escapeHtml(note.caption)}</p>` : ""}
      <div class="note-card-footer"><span><i class="mini-spark">✳</i> A classmate’s notes</span>${owner ? `<button type="button" class="delete-note" data-delete-note="${note.id}">Remove</button>` : ""}</div>
    </div>
  </article>`;
}

function renderNotes() {
  $("#note-count").textContent = `${state.notes.length} ${state.notes.length === 1 ? "note" : "notes"} to explore`;
  if (!state.notes.length) {
    notesGrid.innerHTML = `<div class="empty-state">
      <span class="empty-spark">✳</span><h3>No notes here just yet.</h3>
      <p>Have a page from class? Be the first to share it with your group.</p>
      <button class="button button-primary" data-empty-upload type="button">Share the first note <span aria-hidden="true">↗</span></button>
    </div>`;
    notesGrid.querySelector("[data-empty-upload]").addEventListener("click", openUpload);
    return;
  }
  notesGrid.innerHTML = state.notes.map(noteCard).join("");
  notesGrid.querySelectorAll("[data-note-open]").forEach((button) =>
    button.addEventListener("click", () => openImage(button.dataset.noteOpen)),
  );
  notesGrid.querySelectorAll("[data-delete-note]").forEach((button) =>
    button.addEventListener("click", () => deleteNote(button.dataset.deleteNote, button)),
  );
}

async function loadNotes() {
  notesGrid.innerHTML = `<div class="loading-state"><span class="spinner dark-spinner"></span><span>Finding your notes…</span></div>`;
  const params = new URLSearchParams({
    date: state.date || state.today,
    subject: state.subject,
    q: state.query,
  });
  try {
    const { notes } = await api(`/api/notes?${params.toString()}`);
    state.notes = notes;
    renderNotes();
  } catch (error) {
    notesGrid.innerHTML = `<div class="empty-state"><span class="empty-spark">!</span><h3>We couldn’t load the notes.</h3><p>${escapeHtml(error.message)}</p><button class="button button-outline" type="button" id="retry-load">Try again</button></div>`;
    $("#retry-load").addEventListener("click", loadNotes);
  }
}

function openAuth(mode = "login") {
  state.authMode = mode;
  const isSignup = mode === "signup";
  $("#auth-title").textContent = isSignup ? "Join your study circle." : "Good to have you here.";
  $("#auth-description").textContent = isSignup
    ? "Create an account to share a page of your class notes."
    : "Sign in to share a page of your class notes.";
  $("#name-field").classList.toggle("is-hidden", !isSignup);
  $("#auth-name").required = isSignup;
  $("#auth-password").autocomplete = isSignup ? "new-password" : "current-password";
  $("#auth-submit").textContent = isSignup ? "Create your account" : "Sign in";
  $("#auth-error").textContent = "";
  $("#auth-switch").innerHTML = isSignup
    ? `Already part of the group? <button type="button" data-auth-mode="login">Sign in</button>`
    : `New to the study library? <button type="button" data-auth-mode="signup">Create an account</button>`;
  $("#auth-switch").querySelector("[data-auth-mode]").addEventListener("click", (event) => openAuth(event.currentTarget.dataset.authMode));
  $("#auth-dialog").showModal();
}

function openUpload() {
  if (!state.user) {
    openAuth("login");
    showToast("Sign in first to share notes with your classmates.");
    return;
  }
  $("#upload-error").textContent = "";
  $("#note-date").value = state.date && state.date !== "all" ? state.date : state.today;
  $("#note-date").max = state.today;
  $("#note-subject").value = state.subject === "all" ? SUBJECTS[0] : state.subject;
  resetPhotoPreview();
  $("#upload-dialog").showModal();
}

function resetPhotoPreview() {
  photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  photoPreviewUrls = [];
  $("#note-photo").value = "";
  $("#photo-preview-list").innerHTML = "";
  $("#photo-preview-list").classList.add("is-hidden");
  $("#upload-placeholder").classList.remove("is-hidden");
  $("#photo-dropzone").classList.remove("has-image");
}

function setPhotos(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return;
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (selected.length > 8) {
    $("#upload-error").textContent = "Choose up to 8 photos for one note.";
    $("#note-photo").value = "";
    return;
  }
  if (selected.some((file) => !allowed.includes(file.type))) {
    $("#upload-error").textContent = "Use only JPG, PNG, or WebP photos.";
    $("#note-photo").value = "";
    return;
  }
  const oversized = selected.find((file) => file.size > 8 * 1024 * 1024);
  if (oversized) {
    $("#upload-error").textContent = `${oversized.name} is too large. Each photo can be up to 8 MB.`;
    $("#note-photo").value = "";
    return;
  }
  $("#upload-error").textContent = "";
  photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  photoPreviewUrls = selected.map((file) => URL.createObjectURL(file));
  $("#photo-preview-list").innerHTML = photoPreviewUrls.map((url, index) =>
    `<img class="photo-preview" src="${url}" alt="Preview of class note photo ${index + 1}" />`,
  ).join("");
  $("#photo-preview-list").classList.remove("is-hidden");
  $("#upload-placeholder").classList.add("is-hidden");
  $("#photo-dropzone").classList.add("has-image");
}

async function deleteNote(id, button) {
  if (!confirm("Remove this class note? This can’t be undone.")) return;
  setBusy(button, true, "Removing…");
  try {
    await api(`/api/notes/${id}`, { method: "DELETE" });
    await loadNotes();
    showToast("Your note has been removed.");
  } catch (error) {
    setBusy(button, false);
    showToast(error.message);
  }
}

function openImage(id) {
  const note = state.notes.find((item) => Number(item.id) === Number(id));
  if (!note) return;
  const photoCount = Math.max(1, Number(note.photo_count || 1));
  const overlay = document.createElement("dialog");
  overlay.className = "image-viewer";
  overlay.innerHTML = `<button type="button" class="viewer-close" aria-label="Close photo">×</button>
    <div class="viewer-toolbar">
      ${photoCount > 1 ? `<button class="viewer-nav" type="button" data-viewer-prev aria-label="Previous photo">‹</button>` : ""}
      <span class="viewer-index"></span>
      ${photoCount > 1 ? `<button class="viewer-nav" type="button" data-viewer-next aria-label="Next photo">›</button>` : ""}
    </div>
    <div class="viewer-frame"><img alt="Photo of ${escapeHtml(note.title)} class notes" /></div>
    <div class="viewer-caption"><span>${escapeHtml(note.subject)} · ${escapeHtml(prettyDate(note.lesson_date))}</span><strong>${escapeHtml(note.title)}</strong></div>`;
  document.body.append(overlay);
  const image = overlay.querySelector(".viewer-frame img");
  const indexLabel = overlay.querySelector(".viewer-index");
  let photoIndex = 0;
  const showPhoto = (index) => {
    photoIndex = (index + photoCount) % photoCount;
    image.src = `/api/notes/${note.id}/image/${photoIndex}`;
    indexLabel.textContent = photoCount > 1 ? `Photo ${photoIndex + 1} of ${photoCount}` : "";
  };
  overlay.querySelector("[data-viewer-prev]")?.addEventListener("click", () => showPhoto(photoIndex - 1));
  overlay.querySelector("[data-viewer-next]")?.addEventListener("click", () => showPhoto(photoIndex + 1));
  showPhoto(0);
  overlay.showModal();
  const close = () => {
    overlay.close();
    overlay.remove();
  };
  overlay.querySelector(".viewer-close").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("close", () => overlay.remove(), { once: true });
}

function bindEvents() {
  $("#auth-open").addEventListener("click", () => openAuth());
  ["#hero-upload", "#header-upload", "#how-upload"].forEach((selector) => $(selector).addEventListener("click", openUpload));
  $("#all-dates").addEventListener("click", () => {
    state.date = "all";
    renderDatePicker();
    updateResultsTitle();
    loadNotes();
  });
  $("#clear-filters").addEventListener("click", () => {
    state.date = state.today;
    state.subject = "all";
    state.query = "";
    $("#search-input").value = "";
    renderDatePicker();
    renderSubjectPicker();
    updateResultsTitle();
    loadNotes();
  });
  $("#search-input").addEventListener("input", (event) => {
    state.query = event.currentTarget.value.trim();
    updateResultsTitle();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadNotes, 240);
  });
  document.querySelectorAll("[data-close-modal]").forEach((button) =>
    button.addEventListener("click", () => $(`#${button.dataset.closeModal}`).close()),
  );
  document.querySelectorAll(".modal").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  $("#demo-fill").addEventListener("click", () => {
    $("#auth-email").value = "demo@ndcgl.edu.bd";
    $("#auth-password").value = "NdcStudent2026!";
    $("#auth-error").textContent = "";
  });
  $("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#auth-submit");
    $("#auth-error").textContent = "";
    setBusy(button, true, "One moment…");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { user } = await api(`/api/auth/${state.authMode === "signup" ? "signup" : "login"}`, {
        method: "POST", body: JSON.stringify(body),
      });
      state.user = user;
      renderUser();
      $("#auth-dialog").close();
      await loadNotes();
      showToast(`Welcome, ${user.name.split(" ")[0]}!`);
    } catch (error) {
      $("#auth-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });
  $("#upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#upload-error").textContent = "";
    const button = $("#upload-submit");
    setBusy(button, true, "Sharing your note…");
    try {
      const form = new FormData(event.currentTarget);
      await api("/api/notes", { method: "POST", body: form });
      $("#upload-dialog").close();
      resetPhotoPreview();
      state.date = form.get("lessonDate");
      state.subject = form.get("subject");
      renderDatePicker();
      renderSubjectPicker();
      updateResultsTitle();
      await loadNotes();
      showToast("Your note is in the study library. Thanks for sharing!");
    } catch (error) {
      $("#upload-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });
  $("#note-photo").addEventListener("change", (event) => setPhotos(event.currentTarget.files));
  const dropzone = $("#photo-dropzone");
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    const transfer = new DataTransfer();
    files.slice(0, 8).forEach((file) => transfer.items.add(file));
    $("#note-photo").files = transfer.files;
    setPhotos($("#note-photo").files);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      $("#search-input").focus();
    }
  });
}

async function init() {
  bindEvents();
  $("#note-subject").innerHTML = SUBJECTS.map((subject) => `<option value="${subject}">${subject}</option>`).join("");
  try {
    const [meta, sessionResult] = await Promise.all([api("/api/meta"), api("/api/auth/me")]);
    state.today = meta.today;
    state.date = meta.today;
    state.user = sessionResult.user;
    $("#hero-date").textContent = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" })
      .format(dateFromIso(state.today)).toUpperCase();
    renderUser();
    renderDatePicker();
    renderSubjectPicker();
    updateResultsTitle();
    await loadNotes();
  } catch (error) {
    $("#note-count").textContent = "Study library";
    notesGrid.innerHTML = `<div class="empty-state"><span class="empty-spark">!</span><h3>We couldn’t reach the study library.</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

init();
