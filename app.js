marked.setOptions({ breaks: true, gfm: true });

// Safari and Firefox on macOS skip buttons and links when tabbing unless they
// carry an explicit tabindex.
const TABBABLE = "button, a[href], input:not([type=hidden]), select, textarea";
function ensureTabbable(root) {
  if (root.matches?.(TABBABLE) && !root.hasAttribute("tabindex")) root.tabIndex = 0;
  root.querySelectorAll?.(TABBABLE).forEach(el => {
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
  });
}
new MutationObserver(mutations => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType === 1) ensureTabbable(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
ensureTabbable(document.body);

// --- helpers ---

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function now() {
  return new Date().toISOString();
}

function fmtTimestamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function pickFile(btnId, inputId, onFile) {
  const input = document.getElementById(inputId);
  document.getElementById(btnId).addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    onFile(file);
    input.value = "";
  });
}

// Close on backdrop click, but only when both mousedown and click land on the
// backdrop, so drag-selecting text inside the dialog can't dismiss it.
function closeOnBackdropClick(dlg) {
  let downTarget = null;
  dlg.addEventListener("mousedown", e => downTarget = e.target);
  dlg.addEventListener("click", e => {
    if (e.target === dlg && downTarget === dlg) dlg.close("cancel");
  });
}

// --- state ---
// `data` is the single source of truth: { title, tags, columns, background }.
// The board DOM is a projection of it: mutations update `data`, then call
// commit() to re-render and save. The WeakMaps link rendered elements back to
// the state objects they were rendered from.

let data = null;
const cardOf = new WeakMap();   // card <li> -> card object in data
const columnOf = new WeakMap(); // column <section> -> column object in data

const board = document.getElementById("board");
const notesListEl = document.getElementById("notes-list");
const noteDetailEl = document.getElementById("note-detail");
let selectedNote = null; // the note shown in the detail pane, null when none

function commit() {
  renderBoard();
  renderNotes();
  save();
}

function columnContaining(card) {
  return data.columns.find(col => col.cards.includes(card));
}

// Every card and note, flattened — used when tag edits must touch them all.
function allItems() {
  return [...data.columns.flatMap(col => col.cards), ...data.notes];
}

function elementFor(item) {
  return [...board.querySelectorAll(".card")].find(li => cardOf.get(li) === item);
}

// Create a new item, or update an existing one in place — bumping updatedAt
// only when a field actually changed. Returns the item either way.
function writeItem(item, { title, description, tags }) {
  if (!item) return { title, description, tags, createdAt: now(), updatedAt: now() };
  const changed = item.title !== title ||
    (item.description || "") !== description ||
    (item.tags || []).slice().sort().join("\n") !== tags.slice().sort().join("\n");
  Object.assign(item, { title, description, tags });
  if (changed) item.updatedAt = now();
  return item;
}

// --- persistence ---
// The board lives under "ohnoban-board"; the background image is stored
// separately under "ohnoban-bg" so an oversized image can't take the rest of
// the board down with it.

let quotaWarned = false;

function save() {
  try {
    const { background, ...rest } = data;
    localStorage.setItem("ohnoban-board", JSON.stringify(rest));
    quotaWarned = false;
  } catch (e) {
    if (!quotaWarned) {
      quotaWarned = true;
      alert("Could not save the board.\n\n" + e.message);
    }
  }
}

function saveBackground() {
  try {
    if (data.background?.image) localStorage.setItem("ohnoban-bg", JSON.stringify(data.background));
    else localStorage.removeItem("ohnoban-bg");
    quotaWarned = false;
  } catch (e) {
    quotaWarned = true;
    alert("Background image is too large for local storage.\n\n" + e.message);
    data.background = null;
    localStorage.removeItem("ohnoban-bg");
    applyBackground();
  }
}

function readSavedBackground() {
  const raw = localStorage.getItem("ohnoban-bg");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// --- rendering ---

function fillCard(el, card) {
  const created = card.createdAt ? fmtTimestamp(card.createdAt) : "";
  const updated = card.updatedAt && card.updatedAt !== card.createdAt ? fmtTimestamp(card.updatedAt) : "";
  el.innerHTML = `
    <strong>${esc(card.title)}</strong>
    ${card.description ? `<div class="desc">${marked.parse(card.description)}</div>` : ""}
    ${(card.tags || []).length ? `<div class="tags">${card.tags.map(t =>
      `<span class="tag" style="--tag-bg:${data.tags[t]}">${esc(t)}</span>`
    ).join("")}</div>` : ""}
    ${created || updated ? `<div class="timestamps">${
      created ? `<span>Created ${created}</span>` : ""
    }${
      updated ? `<span>Updated ${updated}</span>` : ""
    }</div>` : ""}
  `;
}

function renderCard(card) {
  const li = document.createElement("li");
  li.className = "card";
  li.draggable = true;
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  cardOf.set(li, card);
  fillCard(li, card);
  return li;
}

function renderColumn(col) {
  const section = document.createElement("section");
  section.className = "column";
  columnOf.set(section, col);
  section.innerHTML = `
    <h2>
      <span class="col-title" title="Click to rename">${esc(col.title)}</span>
      <span class="count">${col.cards.length}</span>
      <span class="col-actions">
        <button class="col-move-btn" data-dir="left" title="Move left" tabindex="-1">‹</button>
        <button class="col-move-btn" data-dir="right" title="Move right" tabindex="-1">›</button>
        <button class="col-delete-btn" title="Delete column" tabindex="-1">×</button>
      </span>
    </h2>
    <a class="add-card" href="#">+ Add card</a>
  `;
  const ul = document.createElement("ul");
  ul.append(...col.cards.map(renderCard));
  section.append(ul);
  return section;
}

function renderBoard() {
  board.replaceChildren(...data.columns.map(renderColumn));
}

// Notes use a master-detail layout: a scrollable list on the left, the one
// selected note rendered on the right.
function renderNoteListItem(note) {
  const li = document.createElement("li");
  li.className = "note-list-item";
  if (note === selectedNote) li.classList.add("selected");
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  cardOf.set(li, note);
  const preview = (note.description || "").replace(/\s+/g, " ").trim();
  li.innerHTML = `<div class="note-list-title">${esc(note.title || "Untitled")}</div>` +
    (preview ? `<div class="note-list-preview">${esc(preview)}</div>` : "");
  return li;
}

function renderNoteDetail() {
  if (!data.notes.includes(selectedNote)) selectedNote = null;
  if (!selectedNote) {
    const p = document.createElement("p");
    p.className = "note-detail-empty";
    p.textContent = data.notes.length
      ? "Select a note to view it."
      : "No notes yet. Use “+ Note” to create one.";
    noteDetailEl.replaceChildren(p);
    return;
  }
  const body = document.createElement("div");
  body.className = "card-view";
  fillCard(body, selectedNote);
  // Wrap the title text so it can shrink/wrap while the Edit button stays put.
  const strong = body.querySelector("strong");
  const titleText = document.createElement("span");
  titleText.className = "note-title-text";
  titleText.append(...strong.childNodes);
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "note-edit-btn";
  editBtn.textContent = "Edit";
  strong.append(titleText, editBtn);
  noteDetailEl.replaceChildren(body);
}

function renderNotes() {
  notesListEl.replaceChildren(...data.notes.map(renderNoteListItem));
  renderNoteDetail();
}

// Open a note in the detail pane without rebuilding the list (keeps focus).
function selectNote(note) {
  selectedNote = note;
  notesListEl.querySelectorAll(".note-list-item").forEach(li => {
    li.classList.toggle("selected", cardOf.get(li) === note);
  });
  renderNoteDetail();
}

// Edit a note in place in the detail pane (note === null when creating one).
function showNoteEditor(note) {
  const form = document.createElement("form");
  form.className = "note-editor";
  form.innerHTML = `
    <label>Title<input name="title" required></label>
    <label class="note-editor-desc">Description<textarea name="description"></textarea></label>
    <fieldset class="note-tags"><legend>Tags</legend></fieldset>
    <div class="note-editor-actions">
      <button type="submit">Save</button>
      <button type="button" class="note-cancel-btn">Cancel</button>
      ${note ? `<button type="button" class="note-delete-btn">Delete</button>` : ""}
    </div>
  `;
  form.title.value = note?.title || "";
  form.description.value = note?.description || "";
  form.querySelector(".note-tags").append(...tagCheckboxLabels(note?.tags || []));
  form.addEventListener("submit", e => {
    e.preventDefault();
    saveNoteEditor(form, note);
  });
  form.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); renderNoteDetail(); }
  });
  form.querySelector(".note-cancel-btn").addEventListener("click", renderNoteDetail);
  if (note) form.querySelector(".note-delete-btn").addEventListener("click", () => deleteNote(note));
  noteDetailEl.replaceChildren(form);
  form.title.focus();
}

function deleteNote(note) {
  const i = data.notes.indexOf(note);
  if (i < 0) return;
  if (!confirm(`Delete note “${note.title || "Untitled"}”?`)) return;
  data.notes.splice(i, 1);
  selectedNote = data.notes[i] || data.notes[i - 1] || null;
  commit();
  reflectHash(noteHash(selectedNote));
}

function saveNoteEditor(form, note) {
  const title = form.title.value.trim();
  if (!title) return;
  const description = form.description.value.trim();
  const tags = [...form.querySelectorAll('input[name="tags"]:checked')].map(cb => cb.value);
  const item = writeItem(note, { title, description, tags });
  if (!note) {
    data.notes.push(item);
    selectedNote = item;
  }
  commit();
  reflectHash(noteHash(item));
}

// --- board interactions (delegated) ---

board.addEventListener("click", e => {
  const addLink = e.target.closest(".add-card");
  if (addLink) {
    e.preventDefault();
    openNewItemDialog(columnOf.get(addLink.closest(".column")).cards);
    return;
  }

  const titleEl = e.target.closest(".col-title");
  if (titleEl) return startColumnRename(titleEl);

  const moveBtn = e.target.closest(".col-move-btn");
  if (moveBtn) return moveColumn(columnOf.get(moveBtn.closest(".column")), moveBtn.dataset.dir);

  if (e.target.closest(".col-delete-btn")) {
    return deleteColumn(columnOf.get(e.target.closest(".column")));
  }

  if (e.target.closest("a[href]")) return; // links inside card descriptions

  const li = e.target.closest(".card");
  if (li) openCard(cardOf.get(li), columnOf.get(li.closest(".column")).cards);
});

board.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (!e.target.classList.contains("card")) return;
  e.preventDefault();
  openCard(cardOf.get(e.target), columnOf.get(e.target.closest(".column")).cards);
});

document.getElementById("add-column-btn").addEventListener("click", () => {
  const title = prompt("Column name:")?.trim();
  if (!title) return;
  data.columns.push({ id: title.toLowerCase().replace(/\s+/g, "-"), title, cards: [] });
  commit();
});

// --- views (board / notes tabs) ---

const tabBar = document.querySelector(".tabs");
const addNoteBtn = document.getElementById("add-note-btn");

// The `notes-view` body class is the single source of truth for which view
// shows; CSS hides #board / #notes / +Column off it.
function setView(view) {
  const isBoard = view === "board";
  document.body.classList.toggle("notes-view", !isBoard);
  tabBar.querySelectorAll(".tab").forEach(tab => {
    tab.setAttribute("aria-selected", String(tab.dataset.view === view));
  });
  if (!isBoard && !selectedNote && data.notes.length) selectNote(data.notes[0]);
}

tabBar.addEventListener("click", e => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  const view = tab.dataset.view;
  setView(view);
  reflectHash(view === "notes" ? noteHash(selectedNote) : "board", true);
});

addNoteBtn.addEventListener("click", () => showNoteEditor(null));

notesListEl.addEventListener("click", e => {
  const li = e.target.closest(".note-list-item");
  if (!li) return;
  const note = cardOf.get(li);
  selectNote(note);
  reflectHash(noteHash(note));
});

notesListEl.addEventListener("keydown", e => {
  const li = e.target.closest(".note-list-item");
  if (!li || (e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault();
  const note = cardOf.get(li);
  selectNote(note);
  reflectHash(noteHash(note));
});

noteDetailEl.addEventListener("click", e => {
  if (e.target.closest(".note-edit-btn")) showNoteEditor(selectedNote);
});

// --- routing (hash deep links) ---
// The URL hash mirrors navigation state: #board, #notes, #notes/<slug>,
// #card/<slug> (slug = the title, lowercased and hyphenated). The handlers
// above change state directly and call reflectHash to update the URL via
// push/replaceState — which do NOT fire hashchange. applyHash runs only for
// real URL changes (initial load, manual edits, back/forward) and drives state
// from the hash. Duplicate titles share a slug; the first match wins.

function slugify(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function noteHash(note) {
  return note ? "notes/" + slugify(note.title) : "notes";
}

function noteBySlug(slug) {
  return data.notes.find(n => slugify(n.title) === slug) || null;
}

function cardBySlug(slug) {
  for (const col of data.columns) {
    const card = col.cards.find(c => slugify(c.title) === slug);
    if (card) return { card, cards: col.cards };
  }
  return null;
}

function openCard(card, cards) {
  openItemDialog(card, cards);
  reflectHash("card/" + slugify(card.title));
}

function reflectHash(hash, push) {
  const url = "#" + hash;
  if (location.hash === url) return;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

function applyHash() {
  const raw = location.hash.replace(/^#/, "");
  const sep = raw.indexOf("/");
  const section = sep === -1 ? raw : raw.slice(0, sep);
  const slug = sep === -1 ? "" : raw.slice(sep + 1);

  if (section === "card") {
    setView("board");
    const found = slug && cardBySlug(slug);
    if (found && !dialog.open) openItemDialog(found.card, found.cards);
    return;
  }
  if (dialog.open) dialog.close(); // navigating away from a card closes it
  if (section === "notes") {
    setView("notes");
    const note = slug && noteBySlug(slug);
    if (note) selectNote(note);
  } else {
    setView("board");
  }
}

window.addEventListener("hashchange", applyHash);

// --- columns ---

function moveColumn(col, dir) {
  const i = data.columns.indexOf(col);
  const j = dir === "left" ? i - 1 : i + 1;
  if (j < 0 || j >= data.columns.length) return;
  [data.columns[i], data.columns[j]] = [data.columns[j], data.columns[i]];
  commit();
}

function deleteColumn(col) {
  const n = col.cards.length;
  if (n > 0 && !confirm(`Delete "${col.title}" and its ${n} card${n > 1 ? "s" : ""}?`)) return;
  data.columns = data.columns.filter(c => c !== col);
  commit();
}

function startColumnRename(titleEl) {
  if (titleEl.isContentEditable) return;
  const col = columnOf.get(titleEl.closest(".column"));
  const original = col.title;
  titleEl.contentEditable = "true";
  titleEl.focus();
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = (keep) => {
    titleEl.removeEventListener("keydown", onKey);
    titleEl.removeEventListener("blur", onBlur);
    titleEl.removeEventListener("paste", onPaste);
    titleEl.removeAttribute("contenteditable");
    const next = titleEl.textContent.trim();
    if (keep && next && next !== original) {
      col.title = next;
      commit();
    } else {
      titleEl.textContent = original;
    }
  };
  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  const onPaste = (e) => {
    // paste as plain text, collapsed to a single line
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") || "").replace(/\s+/g, " ");
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  titleEl.addEventListener("keydown", onKey);
  titleEl.addEventListener("blur", onBlur);
  titleEl.addEventListener("paste", onPaste);
}

// --- card dialog ---

const dialog = document.getElementById("card-dialog");
const form = dialog.querySelector("form");
const cardView = dialog.querySelector(".card-view");
const tagOptions = document.getElementById("tag-options");
// The dialog edits an item (a card). editingContainer is the array it belongs
// to — for an existing item, where it lives (for delete); for a new one, where
// it gets pushed. editingItem is null when adding.
let editingItem = null;
let editingContainer = null;

function setMode(mode) {
  const viewing = mode === "view";
  cardView.hidden = !viewing;
  dialog.querySelector(".card-edit").hidden = viewing;
  dialog.querySelector(".view-actions").hidden = !viewing;
  dialog.querySelector(".edit-actions").hidden = viewing;
  dialog.querySelector(".delete-btn").hidden = !editingItem;
}

function openItemDialog(item, container) {
  editingItem = item;
  editingContainer = container;
  form.title.value = item.title;
  form.description.value = item.description || "";
  form.querySelectorAll('input[name="tags"]').forEach(cb => {
    cb.checked = (item.tags || []).includes(cb.value);
  });
  fillCard(cardView, item);
  setMode("view");
  dialog.returnValue = "";
  dialog.showModal();
}

function openNewItemDialog(container) {
  editingItem = null;
  editingContainer = container;
  form.reset();
  setMode("edit");
  dialog.returnValue = "";
  dialog.showModal();
}

dialog.querySelector(".edit-btn").addEventListener("click", () => setMode("edit"));
closeOnBackdropClick(dialog);

dialog.addEventListener("close", () => {
  if (dialog.returnValue === "save") {
    const title = form.title.value.trim();
    const description = form.description.value.trim();
    const tags = [...form.querySelectorAll('input[name="tags"]:checked')].map(cb => cb.value);
    if (title) {
      const item = writeItem(editingItem, { title, description, tags });
      if (!editingItem) editingContainer.push(item);
      commit();
      elementFor(item)?.focus();
    }
  } else if (dialog.returnValue === "delete" && editingItem) {
    const i = editingContainer.indexOf(editingItem);
    if (i >= 0) editingContainer.splice(i, 1);
    commit();
  }
  editingItem = null;
  editingContainer = null;
  form.description.style.height = "";
  if (location.hash.startsWith("#card")) reflectHash("board");
});

// Arrow keys move the focused card (or the open card while viewing it):
// left/right across columns, up/down within a column.
document.addEventListener("keydown", e => {
  if (!e.key.startsWith("Arrow")) return;
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
  const card = dialog.open ? editingItem : cardOf.get(e.target);
  if (!card) return;
  const col = columnContaining(card);
  if (!col) return; // notes have no column and don't move with arrow keys
  const idx = col.cards.indexOf(card);

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const colIdx = data.columns.indexOf(col);
    const target = data.columns[colIdx + (e.key === "ArrowLeft" ? -1 : 1)];
    if (!target) return;
    e.preventDefault();
    col.cards.splice(idx, 1);
    target.cards.push(card);
    card.updatedAt = now();
  } else {
    const j = idx + (e.key === "ArrowUp" ? -1 : 1);
    if (j < 0 || j >= col.cards.length) return;
    e.preventDefault();
    [col.cards[idx], col.cards[j]] = [col.cards[j], col.cards[idx]];
  }
  commit();
  if (!dialog.open) elementFor(card)?.focus();
});

// --- background ---

const BG_MODES = {
  tile:    { backgroundRepeat: "repeat",    backgroundSize: "auto",  backgroundPosition: "" },
  center:  { backgroundRepeat: "no-repeat", backgroundSize: "auto",  backgroundPosition: "center center" },
  stretch: { backgroundRepeat: "no-repeat", backgroundSize: "cover", backgroundPosition: "center" },
};
const BG_CONTRAST_SAMPLE = 64;
const BG_DARK_THRESHOLD = 0.5;
let bgContrastToken = 0;
let lastContrastImage = null, lastContrastDark = false;

// Sample the image's average luminance and flag the body so text over a dark
// background can switch to light styles.
function updateBgContrast() {
  const bg = data.background;
  if (!bg?.image) {
    lastContrastImage = null;
    document.body.classList.remove("bg-dark");
    return;
  }
  if (bg.image === lastContrastImage) {
    document.body.classList.toggle("bg-dark", lastContrastDark);
    return;
  }
  const token = ++bgContrastToken;
  const img = new Image();
  img.onload = () => {
    if (token !== bgContrastToken) return;
    const w = Math.min(BG_CONTRAST_SAMPLE, img.naturalWidth) || 1;
    const h = Math.min(BG_CONTRAST_SAMPLE, img.naturalHeight) || 1;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const pixelCount = px.length / 4;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum += 0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2];
    }
    const avg = sum / pixelCount / 255;
    lastContrastImage = bg.image;
    lastContrastDark = avg < BG_DARK_THRESHOLD;
    document.body.classList.toggle("bg-dark", lastContrastDark);
  };
  img.onerror = () => { if (token === bgContrastToken) lastContrastImage = null; };
  img.src = bg.image;
}

function applyBackground() {
  const bg = data.background;
  Object.assign(document.body.style, {
    backgroundImage: bg?.image ? `url("${bg.image}")` : "",
    backgroundAttachment: "fixed",
    ...(bg?.image ? (BG_MODES[bg.mode] ?? BG_MODES.tile) : {}),
  });
  updateBgContrast();
}

// --- settings dialog ---

const settingsDialog = document.getElementById("settings-dialog");
const tagList = document.getElementById("tag-list");
const boardNameInput = document.getElementById("board-name-input");
const bgPreview = document.getElementById("bg-preview");
const bgEmpty = document.getElementById("bg-empty");
const bgMode = document.getElementById("bg-mode");
const bgRemoveBtn = document.getElementById("bg-remove-btn");
let pendingBg = null; // background selection staged until the dialog is saved

// A <label> + checkbox per tag, with those in `checked` pre-ticked.
function tagCheckboxLabels(checked) {
  return Object.entries(data.tags).map(([name, color]) => {
    const lbl = document.createElement("label");
    lbl.className = "tag-option";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = "tags";
    cb.value = name;
    cb.checked = checked.includes(name);
    const span = document.createElement("span");
    span.className = "tag";
    span.style.setProperty("--tag-bg", color);
    span.textContent = name;
    lbl.append(cb, span);
    return lbl;
  });
}

function rebuildTagCheckboxes() {
  const legend = tagOptions.querySelector("legend");
  tagOptions.replaceChildren(legend, ...tagCheckboxLabels([]));
}

function createTagRow(name, color) {
  const row = document.createElement("div");
  row.className = "tag-row";
  row.dataset.originalName = name;
  row.innerHTML = `<input type="color" value="${color}" class="tag-color"><input type="text" value="${esc(name)}" class="tag-name" required><button type="button" class="tag-delete-btn" title="Delete tag">&times;</button>`;
  row.querySelector(".tag-delete-btn").addEventListener("click", () => row.remove());
  return row;
}

function refreshBgPreview() {
  const hasImage = !!pendingBg?.image;
  if (hasImage) {
    bgPreview.src = pendingBg.image;
  } else {
    bgPreview.removeAttribute("src");
  }
  bgPreview.hidden = !hasImage;
  bgEmpty.hidden = hasImage;
  bgMode.hidden = !hasImage;
  bgRemoveBtn.hidden = !hasImage;
}

pickFile("bg-choose-btn", "bg-file", file => {
  const reader = new FileReader();
  reader.onload = () => {
    pendingBg = { image: reader.result };
    refreshBgPreview();
  };
  reader.readAsDataURL(file);
});

bgRemoveBtn.addEventListener("click", () => {
  pendingBg = { image: null };
  refreshBgPreview();
});

document.getElementById("settings-btn").addEventListener("click", () => {
  boardNameInput.value = data.title;
  tagList.replaceChildren(...Object.entries(data.tags).map(e => createTagRow(...e)));
  pendingBg = { image: data.background?.image ?? null };
  bgMode.value = data.background?.mode ?? "tile";
  refreshBgPreview();
  settingsDialog.returnValue = "";
  settingsDialog.showModal();
});

document.getElementById("add-tag-btn").addEventListener("click", () => {
  tagList.appendChild(createTagRow("", "#888888"));
  tagList.lastElementChild.querySelector(".tag-name").focus();
});

closeOnBackdropClick(settingsDialog);

settingsDialog.addEventListener("close", () => {
  if (settingsDialog.returnValue !== "save") return;

  const newName = boardNameInput.value.trim();
  if (newName) {
    data.title = newName;
    document.getElementById("board-title").textContent = newName;
  }

  // Rebuild the tag map from the rows, tracking renames and deletions so the
  // tags on cards can be updated to match.
  const renames = {};
  const deletions = new Set(Object.keys(data.tags));
  const newTags = {};
  tagList.querySelectorAll(".tag-row").forEach(row => {
    const name = row.querySelector(".tag-name").value.trim();
    const color = row.querySelector(".tag-color").value;
    if (!name) return;
    const original = row.dataset.originalName;
    newTags[name] = color;
    if (original) {
      deletions.delete(original);
      if (original !== name) renames[original] = name;
    }
  });
  data.tags = newTags;
  for (const item of allItems()) {
    item.tags = (item.tags || []).map(t => renames[t] || t).filter(t => !deletions.has(t));
  }
  rebuildTagCheckboxes();

  data.background = pendingBg?.image ? { image: pendingBg.image, mode: bgMode.value || "tile" } : null;
  applyBackground();

  commit();
  saveBackground();
});

// --- import / export ---

document.getElementById("export-btn").addEventListener("click", () => {
  const out = { title: data.title, tags: data.tags, columns: data.columns, notes: data.notes };
  if (data.background?.image) out.background = data.background;
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "board.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

pickFile("import-btn", "import-file", async file => {
  try {
    const imported = JSON.parse(await file.text());
    if (!imported.title || !Array.isArray(imported.columns)) {
      alert("Invalid board file.");
      return;
    }
    data = {
      title: imported.title,
      tags: imported.tags || {},
      columns: imported.columns,
      notes: Array.isArray(imported.notes) ? imported.notes : [],
      background: imported.background || null,
    };
    selectedNote = data.notes[0] || null;
    document.getElementById("board-title").textContent = data.title;
    rebuildTagCheckboxes();
    applyBackground();
    commit();
    saveBackground();
    settingsDialog.close("cancel");
  } catch {
    alert("Could not parse JSON file.");
  }
});

// --- drag and drop ---
// dragover moves the <li> directly for a live preview; the DOM order is
// adopted into state on drop. dragend re-renders from state, which commits a
// completed drop and snaps a cancelled drag back to where it started.

let dragged = null; // the <li> being dragged
let dragOriginColumn = null;
let overCol = null;
let lastY = 0;

function clearDragOver() {
  if (overCol) { overCol.classList.remove("drag-over"); overCol = null; }
}

function getDragAfterCard(ul, y) {
  const cards = [...ul.querySelectorAll(".card:not(.dragging)")];
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    if (y < box.top + box.height / 2) return card;
  }
  return null;
}

board.addEventListener("dragstart", e => {
  const card = e.target.closest(".card");
  if (!card) return;
  dragged = card;
  dragOriginColumn = columnOf.get(card.closest(".column"));
  card.classList.add("dragging");
  board.classList.add("dragging");
});

board.addEventListener("dragover", e => {
  if (!dragged) return;
  e.preventDefault();
  const col = e.target.closest(".column");
  if (!col) return;

  if (col !== overCol) {
    clearDragOver();
    overCol = col;
    col.classList.add("drag-over");
  }

  if (Math.abs(e.clientY - lastY) < 5) return;
  lastY = e.clientY;

  const ul = col.querySelector("ul");
  const afterCard = getDragAfterCard(ul, e.clientY);
  if (afterCard) ul.insertBefore(dragged, afterCard);
  else ul.appendChild(dragged);
});

board.addEventListener("drop", e => {
  e.preventDefault();
  if (!dragged) return;
  for (const section of board.querySelectorAll(".column")) {
    const col = columnOf.get(section);
    col.cards = [...section.querySelectorAll(".card")].map(li => cardOf.get(li));
  }
  if (columnOf.get(dragged.closest(".column")) !== dragOriginColumn) {
    cardOf.get(dragged).updatedAt = now();
  }
  save();
});

board.addEventListener("dragend", () => {
  clearDragOver();
  dragged = null;
  dragOriginColumn = null;
  lastY = 0;
  board.classList.remove("dragging");
  renderBoard();
});

// --- init ---

function init(initial) {
  data = initial;
  if (!Array.isArray(data.notes)) data.notes = []; // boards saved before notes existed
  selectedNote = data.notes[0] || null;
  if (navigator.storage?.persist) navigator.storage.persist();
  document.getElementById("board-title").textContent = data.title;
  rebuildTagCheckboxes();
  renderBoard();
  renderNotes();
  applyBackground();
  applyHash(); // open the view / note / card named in the URL
}

const saved = localStorage.getItem("ohnoban-board");
if (saved) {
  try {
    const stored = JSON.parse(saved);
    stored.background = readSavedBackground();
    init(stored);
  } catch (e) {
    console.warn("Bad localStorage data, falling back to board.json", e);
    localStorage.removeItem("ohnoban-board");
    fetch("board.json").then(r => r.json()).then(init);
  }
} else {
  fetch("board.json").then(r => r.json()).then(init);
}
