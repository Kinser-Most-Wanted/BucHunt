import { createFoundationServices } from "./adapters.js";
import { mountCreateHunt } from "../features/createHunt.js";
import { mountDefineTask } from "../features/defineTask.js";
import { mountDisplayTasks } from "../features/displayTasks.js";

const services = createFoundationServices();
const createHunt = document.getElementById("create-hunt");
const defineTask = document.getElementById("define-task");
const displayTasks = document.getElementById("display-tasks");
if (createHunt) mountCreateHunt(createHunt, services.repository);
if (defineTask) mountDefineTask(defineTask, services.repository);
if (displayTasks)
  mountDisplayTasks(displayTasks, services.repository);

// Admin Studio waits for its controls before exposing the workspace.
document.documentElement.dataset.buchuntFeaturesReady = "true";
document.dispatchEvent(new Event("buchunt:features-ready"));
