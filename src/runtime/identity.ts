import { createHash, timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";

export type ControlPlanePrincipal = {
  id: string;
  issuer: string;
  displayName?: string;
};

export type ControlPlaneAction =
  | "read"
  | "project.write"
  | "run.start"
  | "run.control"
  | "review.decide";

export type AuthenticatedControlPlaneIdentity = {
  principal: ControlPlanePrincipal;
  authorize(action: ControlPlaneAction): boolean | Promise<boolean>;
};

export type ControlPlaneIdentityProvider<Request = unknown> = {
  authenticate(request: Request): AuthenticatedControlPlaneIdentity | null | Promise<AuthenticatedControlPlaneIdentity | null>;
};

export function createLocalControlPlanePrincipal(): ControlPlanePrincipal {
  let username: string | undefined;
  try {
    username = userInfo().username;
  } catch {
    username = process.env.USERNAME ?? process.env.USER;
  }
  const name = username?.trim();
  if (!name) {
    throw new Error("LOCAL_PRINCIPAL_UNAVAILABLE: Could not resolve the current operating-system user.");
  }
  return { id: `local:${name}`, issuer: "ogs:local", displayName: name };
}

export function createLocalControlPlaneIdentityProvider<Request = unknown>(): ControlPlaneIdentityProvider<Request> {
  const principal = createLocalControlPlanePrincipal();
  return {
    authenticate: () => ({ principal, authorize: () => true })
  };
}

export function createBasicControlPlaneIdentityProvider<Request extends { headers?: { authorization?: string } }>(args: {
  username: string;
  password: string;
}): ControlPlaneIdentityProvider<Request> {
  if (!args.username || args.username.includes(":")) {
    throw new Error("VISUALIZER_BASIC_AUTH_USERNAME_INVALID: Username must be non-empty and cannot contain a colon.");
  }
  if (!args.password) {
    throw new Error("VISUALIZER_BASIC_AUTH_PASSWORD_REQUIRED: Password must be non-empty.");
  }

  const expected = createHash("sha256").update(`${args.username}:${args.password}`).digest();
  return {
    authenticate: (request) => {
      const authorization = request.headers?.authorization;
      const match = typeof authorization === "string" ? /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization) : null;
      if (!match) return null;
      const decoded = Buffer.from(match[1], "base64").toString("utf8");
      if (Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "") !== match[1].replace(/=+$/, "")) return null;
      const separator = decoded.indexOf(":");
      if (separator < 1) return null;
      const actual = createHash("sha256").update(decoded).digest();
      if (!timingSafeEqual(expected, actual)) return null;
      const username = decoded.slice(0, separator);
      return {
        principal: { id: username, issuer: "ogs:basic-auth", displayName: username },
        authorize: () => true
      };
    }
  };
}
