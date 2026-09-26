(() => {
  const slides = [...document.querySelectorAll(".slide")];
  const counter = document.querySelector("#counter");
  const previous = document.querySelector("#previous");
  const next = document.querySelector("#next");
  const notesToggle = document.querySelector("#notes-toggle");
  const notesPanel = document.querySelector("#speaker-panel");
  const speakerText = document.querySelector("#speaker-text");
  let current = 0;

  function showSlide(index) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, position) => {
      slide.classList.toggle("active", position === current);
    });
    counter.textContent = `${current + 1} / ${slides.length}`;
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    speakerText.textContent =
      slides[current].querySelector(".notes").textContent;
    history.replaceState(null, "", `#${current + 1}`);
    document.title = `Shopper Zero — ${current + 1} / ${slides.length}`;
  }

  function readHash() {
    const page = Number(location.hash.slice(1));
    showSlide(Number.isInteger(page) && page > 0 ? page - 1 : 0);
  }

  function toggleNotes(force) {
    const open = typeof force === "boolean" ? force : notesPanel.hidden;
    notesPanel.hidden = !open;
    notesToggle.setAttribute("aria-pressed", String(open));
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      document.querySelector("#fullscreen").textContent =
        "Use browser fullscreen";
    }
  }

  document.body.classList.add("presenting");
  readHash();
  window.addEventListener("hashchange", readHash);
  previous.addEventListener("click", () => showSlide(current - 1));
  next.addEventListener("click", () => showSlide(current + 1));
  notesToggle.addEventListener("click", () => toggleNotes());
  document.querySelector("#notes-close").addEventListener("click", () => {
    toggleNotes(false);
    notesToggle.focus();
  });
  document
    .querySelector("#fullscreen")
    .addEventListener("click", toggleFullscreen);
  document
    .querySelector("#print")
    .addEventListener("click", () => window.print());
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (
      event.target.closest(
        "button, a, input, textarea, select, [contenteditable]",
      )
    )
      return;
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      showSlide(current + 1);
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      showSlide(current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      showSlide(0);
    } else if (event.key === "End") {
      event.preventDefault();
      showSlide(slides.length - 1);
    } else if (event.key.toLowerCase() === "n") {
      toggleNotes();
    } else if (event.key.toLowerCase() === "f") {
      void toggleFullscreen();
    } else if (event.key === "Escape") {
      toggleNotes(false);
    }
  });
})();
