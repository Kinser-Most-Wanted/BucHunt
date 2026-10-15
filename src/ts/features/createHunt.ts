import type { HuntRepository } from "../foundation/contracts.js";
import type { HuntInput } from "../foundation/types.js";

export function mountCreateHunt(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  root.dataset.feature = "createHunt";

  const form = root.querySelector("form");
  const fieldset = root.querySelector("fieldset");
  const statusEl =
    root.ownerDocument.querySelector("[data-testid=\"hunt-status\"]") ||
    root.querySelector("[data-testid=\"hunt-status\"]");
  const errorsEl =
    root.ownerDocument.querySelector("[data-testid=\"validation-errors\"]");

  if (fieldset) {
    fieldset.removeAttribute("disabled");
  }

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (statusEl) {
      statusEl.textContent = "Creating hunt...";
    }
    if (errorsEl) {
      errorsEl.innerHTML = "";
    }

    const formData = new FormData(form);
    const name = (formData.get("name")?.toString() || "").trim();
    const description = (formData.get("description")?.toString() || "").trim();

    const issues: { field: string; message: string }[] = [];
    if (!name) {
      issues.push({ field: "name", message: "Hunt name is required." });
    }
    if (!description) {
      issues.push({ field: "description", message: "Description is required." });
    }

    if (issues.length > 0) {
      if (statusEl) {
        statusEl.textContent = "Hunt creation failed: validation error.";
      }
      if (errorsEl) {
        for (const issue of issues) {
          const li = document.createElement("li");
          li.textContent = `${issue.field}: ${issue.message}`;
          errorsEl.appendChild(li);
        }
      }
      return;
    }

    const input: HuntInput = {
      name,
      description,
      ownerId: "admin",
      beginsAt: new Date().toISOString(),
      endsAt: null,
      taskOrderMode: "sequential",
    };

    try {
      const result = await repository.createHunt(input);
      if (result.ok) {
        if (statusEl) {
          statusEl.textContent = `Hunt created successfully! ID: ${result.value.id}, Name: ${result.value.name}`;
        }
        form.reset();
      } else {
        if (statusEl) {
          statusEl.textContent = `Hunt creation failed: ${result.message}`;
        }
        if (errorsEl && result.issues) {
          for (const issue of result.issues) {
            const li = document.createElement("li");
            li.textContent = `${issue.field}: ${issue.message}`;
            errorsEl.appendChild(li);
          }
        }
      }
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = "Hunt creation failed with an unexpected error.";
      }
      void error;
    }
  });
}
