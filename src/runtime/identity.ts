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
  authenticate(request: Request): AuthenticatedControlPlaneIdentity | Promise<AuthenticatedControlPlaneIdentity>;
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
