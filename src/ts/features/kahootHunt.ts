import type {
  HuntDefinition,
  KahootView,
  PlayerHunt,
  PlayerIdentity,
} from "../foundation/types.js";
import type { HuntRepository } from "../foundation/contracts.js";
import { request } from "./huntRepository.js";

function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}
function rankings(root: HTMLElement, state: KahootView, host: boolean): void {
  const heading = document.createElement("h3");
  heading.textContent = "Leaderboard";
  const list = document.createElement("ol");
  for (const player of state.leaderboard) {
    const item = document.createElement("li");
    item.textContent = `${player.displayName}: ${player.score} points${host ? ` · ${player.active ? (player.connected ? "Connected" : "Awaiting reconnect") : "Left"}${state.phase === "question" ? (player.submitted ? " · Answered" : " · Waiting for answer") : ""}` : ""}`;
    list.append(item);
  }
  root.replaceChildren(heading, list);
}
function phaseText(state: KahootView): string {
  if (state.phase === "lobby")
    return "The host has not started the hunt. Waiting in the lobby…";
  if (state.phase === "finished")
    return "Hunt complete! See the final leaderboard below.";
  if (state.phase === "results")
    return "Question ended. Waiting for the host to release the next question.";
  return `Question ${state.questionNumber} of ${state.totalQuestions}${state.submitted ? " · Answer submitted. Waiting for the other players or the timer." : ""}`;
}
function poll(
  operation: () => Promise<void>,
  alive: () => boolean,
): () => void {
  let busy = false;
  const run = async () => {
    if (busy || !alive()) return;
    busy = true;
    try {
      await operation();
    } finally {
      busy = false;
    }
  };
  void run();
  const timer = window.setInterval(() => void run(), 1000);
  return () => window.clearInterval(timer);
}
export function mountKahootHost(
  dialog: HTMLDialogElement,
  hunt: HuntDefinition,
  allowed: boolean,
): () => void {
  const panel = dialog.querySelector<HTMLElement>(
    '[data-testid="kahoot-host"]',
  );
  if (!panel) return () => {};
  panel.hidden = hunt.huntType !== "kahoot" || !allowed;
  panel.replaceChildren();
  if (panel.hidden) return () => {};
  let disposed = false;
  let acting = false;
  const heading = document.createElement("h3");
  heading.textContent = "Kahoot host dashboard";
  const status = paragraph("Loading lobby…");
  status.setAttribute("role", "status");
  const error = paragraph("");
  error.setAttribute("role", "status");
  const question = paragraph("");
  const controls = document.createElement("div");
  controls.className = "kahoot-controls";
  const board = document.createElement("div");
  panel.append(heading, status, question, controls, error, board);
  function render(state: KahootView) {
    status.textContent = phaseText(state);
    question.textContent = state.question
      ? `${state.question.displayLabel}: ${state.question.description}`
      : "";
    controls.replaceChildren();
    const actions: [string, string][] =
      state.phase === "lobby"
        ? [["start", "Start hunt"]]
        : state.phase === "question"
          ? [
              ["end-question", "End question"],
              ["end", "End hunt"],
            ]
          : state.phase === "results"
            ? [
                ["next", "Next question"],
                ["end", "End hunt"],
              ]
            : [];
    for (const [action, label] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "action";
      button.textContent = label;
      button.disabled = acting;
      button.onclick = async () => {
        if (acting) return;
        acting = true;
        controls
          .querySelectorAll("button")
          .forEach((button) => (button.disabled = true));
        const result = await request<KahootView>(
          `/api/admin/hunts/${hunt.id}/kahoot`,
          { action },
        );
        acting = false;
        if (disposed) return;
        error.textContent = result.ok ? "" : result.message;
        if (result.ok) render(result.value);
        else await refresh();
      };
      controls.append(button);
    }
    rankings(board, state, true);
  }
  async function refresh() {
    if (acting) return;
    const result = await request<KahootView>(
      `/api/admin/hunts/${hunt.id}/kahoot`,
    );
    if (disposed) return;
    if (result.ok) render(result.value);
    else error.textContent = result.message;
  }
  const stop = poll(refresh, () => !disposed && dialog.open);
  const dispose = () => {
    disposed = true;
    stop();
  };
  dialog.addEventListener("close", dispose, { once: true });
  return () => {
    dialog.removeEventListener("close", dispose);
    dispose();
    panel.hidden = true;
  };
}
export function mountKahootPlayer(
  panel: HTMLElement,
  hunt: PlayerHunt,
  identity: PlayerIdentity,
  repository: HuntRepository,
): () => void {
  let disposed = false;
  let sending = false;
  let signature = "";
  let state = hunt.kahoot;
  let receivedAt = Date.now();
  const status = paragraph("");
  status.setAttribute("role", "status");
  const timer = paragraph("");
  timer.setAttribute("aria-live", "off");
  const content = document.createElement("div");
  const error = paragraph("");
  error.setAttribute("role", "status");
  const board = document.createElement("div");
  panel.append(status, timer, content, error, board);
  function render(current: KahootView) {
    state = current;
    receivedAt = Date.now();
    status.textContent = phaseText(current);
    rankings(board, current, false);
    const nextSignature = JSON.stringify([
      current.phase,
      current.question?.id,
      current.submitted,
      current.correct,
      current.pointsAwarded,
    ]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    content.replaceChildren();
    if (current.correct !== undefined)
      content.append(
        paragraph(
          current.correct
            ? `Correct! ${current.pointsAwarded} points.`
            : "Answer recorded. No points for this question.",
        ),
      );
    const question = current.question;
    if (current.phase !== "question" || !question || current.submitted) return;
    const heading = document.createElement("h3");
    heading.textContent = question.displayLabel;
    content.append(heading, paragraph(question.description));
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = "Your answer";
    const input =
      question.taskType === "multiple-choice"
        ? document.createElement("select")
        : document.createElement("input");
    input.name = "answer";
    input.required = true;
    if (input instanceof HTMLSelectElement) {
      input.add(new Option("Select an answer", ""));
      for (const choice of question.choices ?? [])
        input.add(new Option(choice, choice));
    } else {
      input.autocomplete = "off";
      input.maxLength = 4000;
    }
    label.append(input);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "action";
    submit.textContent = "Submit answer";
    form.append(label, submit);
    content.append(form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (sending) return;
      sending = true;
      submit.disabled = true;
      input.disabled = true;
      const result = await repository.answerAccountTask(
        hunt.id,
        question.id,
        input.value,
        identity,
      );
      sending = false;
      if (disposed) return;
      error.textContent = result.ok ? "" : result.message;
      // Wrong answers are also final submissions in Kahoot Hunts.
      if (result.ok && state?.question?.id === question.id)
        render({ ...state, submitted: true });
      await refresh();
      if (!result.ok) {
        submit.disabled = false;
        input.disabled = false;
      }
    };
  }
  async function refresh() {
    const result = await repository.getAccountHunt(hunt.id, identity);
    if (disposed) return;
    if (result.ok && result.value.kahoot) {
      error.textContent = "";
      render(result.value.kahoot);
    } else {
      error.textContent = result.ok
        ? "Game state is unavailable."
        : result.message;
      if (
        !result.ok &&
        (result.code === "forbidden" || result.code === "unauthorized")
      ) {
        content.replaceChildren();
        signature = "";
      }
    }
  }
  if (state) render(state);
  const stop = poll(refresh, () => !disposed);
  const clock = window.setInterval(() => {
    if (!state) return;
    if (state.phase !== "question") {
      timer.textContent = "";
      return;
    }
    const remaining =
      state.deadline === null
        ? null
        : Math.max(
            0,
            Math.ceil(
              (state.deadline - (state.serverNow + Date.now() - receivedAt)) /
                1000,
            ),
          );
    timer.textContent =
      remaining === null
        ? "No question time limit"
        : `${remaining} seconds remaining`;
    if (remaining === 0)
      content
        .querySelectorAll<
          HTMLInputElement | HTMLButtonElement | HTMLSelectElement
        >("input, button, select")
        .forEach((control) => (control.disabled = true));
  }, 250);
  return () => {
    disposed = true;
    stop();
    window.clearInterval(clock);
  };
}
