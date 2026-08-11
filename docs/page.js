const openers = document.querySelectorAll("[data-open-modal]");
const modals = document.querySelectorAll("[data-modal]");
let opener = null;

window.addEventListener("error", (event) => {
  document.documentElement.dataset.pageError = event.message || "Unknown page error";
});
window.addEventListener("unhandledrejection", (event) => {
  document.documentElement.dataset.pageError = String(event.reason || "Unhandled promise rejection");
});

function closeModal(modal) {
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  opener?.focus();
  opener = null;
}

for (const button of openers) {
  button.addEventListener("click", () => {
    opener = button;
    const modal = document.querySelector(`[data-modal="${button.dataset.openModal}"]`);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    modal.querySelector("[data-close-modal]")?.focus();
  });
}

for (const modal of modals) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close-modal]")) {
      closeModal(modal);
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const modal = [...modals].find((item) => !item.hidden);
  if (modal) closeModal(modal);
});
