const TEAM_PACKAGE_MODE = "team-v2";
const credentialFields = new Set([
  "apikey", "accesstoken", "refreshtoken", "password", "clientsecret",
  "clientpassword", "secretvalue", "credentialvalue", "privatekey"
]);

export function createTeamPackageValidationUseCases({ packageIntegrity }) {
  if (!packageIntegrity
    || typeof packageIntegrity.computePackageDigest !== "function"
    || typeof packageIntegrity.computeTeamPackageCoreDigest !== "function") {
    throw new TypeError("Team package validation requires package integrity operations.");
  }

  function findCredentialField(value, path = "") {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const found = findCredentialField(value[index], `${path}[${index}]`);
        if (found) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      if (credentialFields.has(normalizedKey) && child !== undefined && child !== null && !(typeof child === "string" && !child.trim())) {
        return path ? `${path}.${key}` : key;
      }
      const found = findCredentialField(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return undefined;
  }

  async function validateTeamPackage(bundle) {
    if (!bundle || bundle.mode !== TEAM_PACKAGE_MODE) {
      throw new Error(`PROJECT_PACKAGE_VERSION_UNSUPPORTED: expected mode=${TEAM_PACKAGE_MODE}.`);
    }
    if (!bundle.team || typeof bundle.team.systemSource !== "string") {
      throw new Error("TEAM_IMPORT_INVALID: team package is missing systemSource.");
    }
    const manifestPaths = bundle.releaseManifest?.artifactScope || bundle.team.releaseManifest?.artifactScope || [];
    if (!Array.isArray(manifestPaths) || manifestPaths.some((path) => {
      if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return true;
      return path.split("/").some((part) => part === ".." || part === "");
    })) throw new Error("PROJECT_IMPORT_INVALID: unsafe artifact path.");
    if (bundle.team.systemSource.length > 2 * 1024 * 1024) throw new Error("TEAM_IMPORT_INVALID: system source is too large.");

    const calculatedPackageDigest = packageIntegrity.computePackageDigest(bundle);
    if (bundle.packageDigest && bundle.packageDigest !== calculatedPackageDigest) {
      throw new Error("TEAM_IMPORT_DIGEST_MISMATCH: packageDigest does not match package contents.");
    }
    const calculatedTeamCoreDigest = packageIntegrity.computeTeamPackageCoreDigest(bundle);
    if (bundle.teamCoreDigest && bundle.teamCoreDigest !== calculatedTeamCoreDigest) {
      throw new Error("TEAM_IMPORT_DIGEST_MISMATCH: teamCoreDigest does not match team contents.");
    }
    const credentialPath = findCredentialField(bundle);
    if (credentialPath) throw new Error(`PROJECT_IMPORT_INVALID: credential field is not accepted: ${credentialPath}.`);
    return {
      bundle,
      metadata: bundle.team.project || {},
      teamCoreDigest: bundle.teamCoreDigest || calculatedTeamCoreDigest,
      packageDigest: bundle.packageDigest || calculatedPackageDigest
    };
  }

  return Object.freeze({ validateTeamPackage });
}
