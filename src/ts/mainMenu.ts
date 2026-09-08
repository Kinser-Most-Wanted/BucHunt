// mainMenu.ts

// --- Navigation helper ---
function navigateToPage(path: string): void {
  window.location.href = path;
}

// --- Main Menu initialization for index.html ---
function initIndexMenu(): void {
  const startGameButton = document.getElementById("start-game-btn");
  const settingsButton = document.getElementById("settings-btn");

  startGameButton?.addEventListener("click", () => {
    navigateToPage("./game.html");
  });

  settingsButton?.addEventListener("click", () => {
    navigateToPage("./settings.html");
  });
}

// --- Game Menu initialization for game.html ---
function initGameMenu(): void {
  const mainMenuBtn = document.getElementById("mainMenuBtn");

  mainMenuBtn?.addEventListener("click", () => {
    const confirmLeave = confirm(
      "Are you sure you want to return to the main menu? Unsaved progress will be lost."
    );
    if (confirmLeave) {
      navigateToPage("./index.html");
    }
  });
}

// --- Auto-detect page and initialize ---
window.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("start-game-btn")) {
    // index.html detected
    initIndexMenu();
  }

  if (document.getElementById("mainMenuBtn")) {
    // game.html detected
    initGameMenu();
  }
});
