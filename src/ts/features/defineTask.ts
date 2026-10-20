import type { HuntRepository } from "../foundation/contracts.js";
import type { TaskDefinition, TaskInput } from "../foundation/types.js";

interface MapPoint {
  lat: number;
  lng: number;
}

interface LeafletMarker {
  addTo(map: LeafletMap): LeafletMarker;
  getLatLng(): MapPoint;
  on(event: "dragend", listener: () => void): LeafletMarker;
  setLatLng(point: MapPoint): LeafletMarker;
}

interface LeafletMap {
  addLayer(layer: LeafletMarker): LeafletMap;
  invalidateSize(): void;
  on(
    event: "click",
    listener: (event: { latlng: MapPoint }) => void,
  ): LeafletMap;
  removeLayer(layer: LeafletMarker): LeafletMap;
  setView(point: [number, number], zoom: number): LeafletMap;
}

interface LeafletApi {
  map(element: HTMLElement, options?: Record<string, unknown>): LeafletMap;
  marker(
    point: [number, number],
    options: { draggable: boolean },
  ): LeafletMarker;
  tileLayer(
    url: string,
    options: { maxZoom: number; attribution: string },
  ): { addTo(map: LeafletMap): void };
}

declare global {
  interface Window {
    L?: LeafletApi;
  }
}

const DEFAULT_MAP_CENTER: [number, number] = [36.302, -82.369];

function field<T extends HTMLInputElement | HTMLTextAreaElement>(
  form: HTMLFormElement,
  name: string,
): T | null {
  return form.querySelector<T>(`[name="${name}"]`);
}

function showIssues(root: HTMLElement, messages: string[]): void {
  const list = root.querySelector<HTMLUListElement>(
    '[data-testid="validation-errors"]',
  );
  if (!list) return;
  list.replaceChildren();
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
}

function mountLocationPicker(root: HTMLElement, form: HTMLFormElement): void {
  const mapElement = root.querySelector<HTMLDivElement>(
    '[data-testid="task-location-map"]',
  );
  const searchControls = root.querySelector<HTMLElement>(
    '[data-testid="task-location-search-form"]',
  );
  const queryInput = root.querySelector<HTMLInputElement>(
    '[data-testid="task-location-query"]',
  );
  const status = root.querySelector<HTMLElement>(
    '[data-testid="task-location-status"]',
  );
  const coordinates = root.querySelector<HTMLOutputElement>(
    '[data-testid="task-location-coordinates"]',
  );
  const latitude = field<HTMLInputElement>(form, "latitude");
  const longitude = field<HTMLInputElement>(form, "longitude");
  if (
    !mapElement ||
    !searchControls ||
    !queryInput ||
    !status ||
    !coordinates ||
    !latitude ||
    !longitude
  )
    return;

  const L = window.L;
  if (!L) {
    status.textContent =
      "The map library could not load. Refresh the page to try again.";
    return;
  }

  const map = L.map(mapElement, { scrollWheelZoom: false }).setView(
    DEFAULT_MAP_CENTER,
    16,
  );
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  let marker: LeafletMarker | null = null;
  let lastSearchAt = 0;
  const searchCache = new Map<string, { point: MapPoint; label: string }>();
  const setLocation = (point: MapPoint, label?: string): void => {
    latitude.value = String(point.lat);
    longitude.value = String(point.lng);
    if (marker) marker.setLatLng(point);
    else {
      marker = L.marker([point.lat, point.lng], { draggable: true }).addTo(map);
      marker.on("dragend", () => {
        if (marker) setLocation(marker.getLatLng());
      });
    }
    coordinates.textContent = label
      ? `${label} · ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
      : `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
    coordinates.hidden = false;
    status.textContent =
      "Location selected. Click the map or drag the pin to adjust it.";
  };

  map.on("click", (event) => setLocation(event.latlng));
  const searchButton =
    searchControls.querySelector<HTMLButtonElement>("button");
  const search = async (): Promise<void> => {
    const query = queryInput.value.trim();
    if (!query) {
      status.textContent = "Enter a place or address to search.";
      return;
    }

    const key = query.toLocaleLowerCase();
    let result = searchCache.get(key);
    if (searchButton) searchButton.disabled = true;
    status.textContent = "Searching the map…";
    try {
      if (!result) {
        const wait = Math.max(0, 1100 - (Date.now() - lastSearchAt));
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        lastSearchAt = Date.now();
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("limit", "1");
        url.searchParams.set("q", query);
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          cache: "default",
        });
        if (!response.ok) throw new Error("Search unavailable");
        const matches = (await response.json()) as Array<{
          lat: string;
          lon: string;
          display_name: string;
        }>;
        const match = matches[0];
        if (!match) {
          status.textContent =
            "No matching place found. Try a different search.";
          return;
        }
        result = {
          point: { lat: Number(match.lat), lng: Number(match.lon) },
          label: match.display_name,
        };
        if (
          !Number.isFinite(result.point.lat) ||
          !Number.isFinite(result.point.lng)
        )
          throw new Error("Invalid search result");
        searchCache.set(key, result);
      }
      map.setView([result.point.lat, result.point.lng], 18);
      setLocation(result.point, result.label);
    } catch {
      status.textContent =
        "Place search is unavailable. Try again or select directly on the map.";
    } finally {
      if (searchButton) searchButton.disabled = false;
    }
  };
  searchButton?.addEventListener("click", () => void search());
  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void search();
    }
  });

  form.addEventListener("reset", () => {
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }
    coordinates.textContent = "";
    coordinates.hidden = true;
    queryInput.value = "";
    status.textContent =
      "Search for a place or click the map to choose a location.";
  });

  status.textContent =
    "Search for a place or click the map to choose a location.";
  window.requestAnimationFrame(() => map.invalidateSize());
}

function renderTasks(root: HTMLElement, tasks: TaskDefinition[]): void {
  const list = root.querySelector<HTMLOListElement>(
    '[data-testid="defined-task-list"]',
  );
  if (!list) return;
  list.replaceChildren();
  for (const task of [...tasks].sort(
    (left, right) => left.order - right.order,
  )) {
    const item = document.createElement("li");
    item.className = "defined-task";
    const order = document.createElement("span");
    order.className = "task-order";
    order.textContent = String(task.order).padStart(2, "0");
    const content = document.createElement("span");
    content.className = "task-summary";
    const label = document.createElement("strong");
    label.textContent = task.displayLabel;
    const description = document.createElement("span");
    description.textContent = task.description;
    content.append(label, description);
    item.append(order, content);
    list.append(item);
  }
}

export function mountDefineTask(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  root.dataset.feature = "defineTask";
  const form = root.querySelector<HTMLFormElement>('[data-testid="task-form"]');
  const status = root.querySelector<HTMLElement>('[data-testid="task-status"]');
  if (!form || !status) return;
  mountLocationPicker(root, form);
  root.addEventListener("hunt-selected", () => {
    renderTasks(root, []);
    showIssues(root, []);
    const order = field<HTMLInputElement>(form, "order");
    if (order) order.value = "1";
    status.textContent =
      "Hunt selection updated. Add a task or load its saved tasks.";
  });

  root
    .querySelector('[data-testid="load-admin-hunt"]')
    ?.addEventListener("click", async () => {
      const id = field<HTMLInputElement>(form, "huntId")?.value.trim() ?? "";
      if (!id) {
        status.textContent = "Choose a hunt from My hunts first.";
        return;
      }
      try {
        const result = await repository.getAdminHunt(id);
        if (!result.ok) {
          showIssues(root, [result.message]);
          return;
        }
        renderTasks(root, result.value.tasks);
        const order = field<HTMLInputElement>(form, "order");
        if (order)
          order.value = String(
            Math.max(0, ...result.value.tasks.map((task) => task.order)) + 1,
          );
        status.textContent = `${result.value.tasks.length} tasks loaded for ${result.value.name}.`;
      } catch {
        status.textContent = "The hunt service could not be reached.";
      }
    });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showIssues(root, []);

    const huntId = field<HTMLInputElement>(form, "huntId")?.value.trim() ?? "";
    const displayLabel =
      field<HTMLInputElement>(form, "displayLabel")?.value.trim() ?? "";
    const description =
      field<HTMLTextAreaElement>(form, "description")?.value.trim() ?? "";
    const requiredAnswer =
      field<HTMLInputElement>(form, "requiredAnswer")?.value.trim() ?? "";
    const latitudeValue =
      field<HTMLInputElement>(form, "latitude")?.value ?? "";
    const longitudeValue =
      field<HTMLInputElement>(form, "longitude")?.value ?? "";
    const orderValue = field<HTMLInputElement>(form, "order")?.value ?? "";
    const pointsValue = field<HTMLInputElement>(form, "points")?.value ?? "0";
    const hintValue = field<HTMLInputElement>(form, "hint")?.value.trim() ?? "";
    const answerCaseSensitive =
      field<HTMLInputElement>(form, "answerCaseSensitive")?.checked ?? false;

    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    const order = Number(orderValue);
    const points = Number(pointsValue);
    const issues: string[] = [];
    if (!huntId) issues.push("Enter the hunt ID for this task.");
    if (!displayLabel) issues.push("Enter a display label.");
    if (!description) issues.push("Enter the clue and instructions.");
    if (!requiredAnswer) issues.push("Enter the required answer.");
    if (
      latitudeValue === "" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    )
      issues.push("Latitude must be a number from -90 to 90.");
    if (
      longitudeValue === "" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      issues.push("Longitude must be a number from -180 to 180.");
    if (!Number.isInteger(order) || order < 1)
      issues.push("Task order must be a whole number of at least 1.");
    if (!Number.isInteger(points) || points < 0)
      issues.push("Points must be a whole number of 0 or more.");
    if (issues.length) {
      showIssues(root, issues);
      status.textContent = "Check the highlighted task details and try again.";
      return;
    }

    const task: TaskInput = {
      displayLabel,
      description,
      requiredAnswer,
      location: { latitude, longitude },
      order,
      answerCaseSensitive,
      hint: hintValue || null,
      points,
    };
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (button) button.disabled = true;
    status.textContent = "Saving task…";
    try {
      const saved = await repository.addTask(huntId, task);
      if (!saved.ok) {
        showIssues(
          root,
          saved.issues?.map((issue) => issue.message) ?? [saved.message],
        );
        status.textContent = "Task was not saved.";
        return;
      }

      status.textContent = "Task saved. Refreshing the hunt task list…";
      const result = await repository.getAdminHunt(huntId);
      if (result.ok) {
        renderTasks(root, result.value.tasks);
        status.textContent = `“${saved.value.displayLabel}” was saved and appears in this hunt’s task list.`;
        form.reset();
        const pointsInput = field<HTMLInputElement>(form, "points");
        const orderInput = field<HTMLInputElement>(form, "order");
        if (pointsInput) pointsInput.value = "0";
        if (orderInput)
          orderInput.value = String(
            Math.max(0, ...result.value.tasks.map((task) => task.order)) + 1,
          );
        const huntInput = field<HTMLInputElement>(form, "huntId");
        if (huntInput) huntInput.value = huntId;
      } else {
        status.textContent = `Task was saved, but the updated hunt list could not be loaded: ${result.message}`;
      }
    } catch {
      status.textContent = "The task service could not be reached. Try again.";
    } finally {
      if (button) button.disabled = false;
    }
  });
}
