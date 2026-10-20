import { createFoundationServices } from "./adapters.js";
import { mountAdminAccess } from "../features/adminAccess.js";
import { mountCreateHunt } from "../features/createHunt.js";
import { mountDefineTask } from "../features/defineTask.js";
import { mountDisplayTasks } from "../features/displayTasks.js";

const services = createFoundationServices();
const adminAccess = document.getElementById("admin-access");
const createHunt = document.getElementById("create-hunt");
const defineTask = document.getElementById("define-task");
const displayTasks = document.getElementById("display-tasks");
if (adminAccess) mountAdminAccess(adminAccess, services.authentication);
if (createHunt) mountCreateHunt(createHunt, services.repository);
if (defineTask) mountDefineTask(defineTask, services.repository);
if (displayTasks) mountDisplayTasks(displayTasks, services.repository);
