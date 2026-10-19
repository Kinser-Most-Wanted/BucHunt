import type { AuthenticationService } from "../foundation/contracts.js";
import type {
  AdminCredentials,
  AdminSession,
  OperationResult,
} from "../foundation/types.js";

const SESSION_KEY = "buchunt.admin-session";
const DEMO_USERNAME = "admin";
const DEMO_PASSWORD = "password";

function readSession(): AdminSession {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as
      | Partial<AdminSession>
      | null;
    if (value?.authenticated === true && value.username === DEMO_USERNAME) {
      return { authenticated: true, username: DEMO_USERNAME };
    }
  } catch {
    // A missing or unreadable browser session is treated as signed out.
  }
  return { authenticated: false, username: "" };
}

export function createAuthenticationService(): AuthenticationService {
  return {
    async signIn(credentials: AdminCredentials): Promise<OperationResult<AdminSession>> {
      if (
        credentials.username !== DEMO_USERNAME ||
        credentials.password !== DEMO_PASSWORD
      ) {
        return {
          ok: false,
          code: "unauthorized",
          message: "Username or password is incorrect.",
        };
      }

      const session = { authenticated: true, username: DEMO_USERNAME };
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        return {
          ok: false,
          code: "storage",
          message: "This browser could not keep the demo sign-in session.",
        };
      }
      return { ok: true, value: session };
    },

    async getSession(): Promise<OperationResult<AdminSession>> {
      return { ok: true, value: readSession() };
    },

    async signOut(): Promise<OperationResult<void>> {
      try {
        sessionStorage.removeItem(SESSION_KEY);
        return { ok: true, value: undefined };
      } catch {
        return {
          ok: false,
          code: "storage",
          message: "This browser could not clear the demo sign-in session.",
        };
      }
    },
  };
}

export function mountAdminAccess(
  root: HTMLElement,
  service: AuthenticationService,
): void {
  root.dataset.feature = "admin-access";
  const form = root.querySelector<HTMLFormElement>(
    '[data-testid="admin-login-form"]',
  );
  const status = root.querySelector<HTMLElement>(
    '[data-testid="auth-status"]',
  );
  const controls = root.querySelector<HTMLElement>(
    '[data-testid="admin-controls"]',
  );
  const signOut = root.querySelector<HTMLButtonElement>(
    '[data-testid="admin-sign-out"]',
  );
  if (!form || !status || !controls || !signOut) return;

  const displaySession = (session: AdminSession): void => {
    form.hidden = session.authenticated;
    controls.inert = !session.authenticated;
    signOut.hidden = !session.authenticated;
    status.textContent = session.authenticated
      ? `Signed in as ${session.username}. This is a browser-only prototype; it does not protect server operations.`
      : "Sign in to open the administration controls.";
  };

  void service.getSession().then((result) => {
    displaySession(result.ok ? result.value : { authenticated: false, username: "" });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const result = await service.signIn({
      username: String(data.get("username") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    });
    if (!result.ok) {
      status.textContent = result.message;
      return;
    }
    displaySession(result.value);
  });

  signOut.addEventListener("click", async () => {
    const result = await service.signOut();
    if (!result.ok) {
      status.textContent = result.message;
      return;
    }
    displaySession({ authenticated: false, username: "" });
  });
}

