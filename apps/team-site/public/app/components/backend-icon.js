import { esc } from "./dom.js";

const LOCAL_BACKEND_ICON_REGISTRY = Object.freeze({
  codex: {
    iconKey: "codex",
    displayName: "Codex",
    initials: "CX",
    assetPath: "/assets/backend-icons/codex.svg"
  },
  opencode: {
    iconKey: "opencode",
    displayName: "OpenCode",
    initials: "OC",
    assetPath: "/assets/backend-icons/opencode.svg"
  },
  ollama: {
    iconKey: "ollama",
    displayName: "Ollama",
    initials: "OL",
    assetPath: "/assets/backend-icons/ollama.svg"
  },
  "claude-code": {
    iconKey: "claude-code",
    displayName: "Claude Code",
    initials: "CC",
    assetPath: "/assets/backend-icons/claude-code.svg"
  },
  "gemini-cli": {
    iconKey: "gemini-cli",
    displayName: "Gemini CLI",
    initials: "GM",
    assetPath: "/assets/backend-icons/gemini-cli.svg"
  },
  "copilot-cli": {
    iconKey: "copilot-cli",
    displayName: "GitHub Copilot CLI",
    initials: "CP",
    assetPath: "/assets/backend-icons/copilot-cli.svg"
  },
  "qwen-code": {
    iconKey: "qwen-code",
    displayName: "Qwen Code",
    initials: "QW",
    assetPath: "/assets/backend-icons/qwen-code.svg"
  },
  "kimi-cli": {
    iconKey: "kimi-cli",
    displayName: "Kimi CLI",
    initials: "KM",
    assetPath: "/assets/backend-icons/kimi-cli.svg"
  }
});

const GENERIC_BACKEND_ICON = Object.freeze({
  iconKey: "generic-backend",
  displayName: "CLI Backend",
  initials: "CLI",
  assetPath: "/assets/backend-icons/generic-backend.svg"
});

function buildInitialsFallback(backendId) {
  const parts = String(backendId || "")
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return GENERIC_BACKEND_ICON.initials;
}

export function resolveBackendIconEntry(backendId, displayName, iconKey) {
  const normalized = String(backendId || "").trim().toLowerCase();
  const requestedIconKey = String(iconKey || "").trim().toLowerCase();
  const matched = LOCAL_BACKEND_ICON_REGISTRY[normalized]
    || LOCAL_BACKEND_ICON_REGISTRY[requestedIconKey];
  if (matched) {
    return {
      ...matched,
      backendId: normalized,
      displayName: displayName || matched.displayName
    };
  }
  return {
    ...GENERIC_BACKEND_ICON,
    backendId: normalized || "unknown",
    displayName: displayName || normalized || GENERIC_BACKEND_ICON.displayName,
    initials: buildInitialsFallback(normalized)
  };
}

export function renderBackendIcon(backendId, { displayName, iconKey, status, size = 22 } = {}) {
  const entry = resolveBackendIconEntry(backendId, displayName, iconKey);
  const label = `${entry.displayName} (${entry.backendId})`;
  const stateClass = ["unavailable", "not_installed", "installed_but_broken", "service_unavailable"].includes(status)
    ? " backend-icon--muted"
    : "";
  const pixelSize = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 22;
  return `<span class="backend-icon backend-icon--${esc(entry.iconKey)}${stateClass}" role="img" aria-label="${esc(label)}" title="${esc(label)}" style="--backend-icon-size:${pixelSize}px"><img src="${esc(entry.assetPath)}" alt="" width="${pixelSize}" height="${pixelSize}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="backend-icon-initials" aria-hidden="true" hidden>${esc(entry.initials)}</span></span>`;
}

export function formatBackendStatusBadge(status, locale = "zh") {
  const english = locale === "en";
  switch (status) {
    case "runnable":
      return {
        label: english ? "Runnable" : "可运行",
        chipClass: "confirmed"
      };
    case "unavailable":
      return {
        label: english ? "Unavailable" : "暂不可用",
        chipClass: "warning"
      };
    case "not_installed":
      return {
        label: english ? "Not installed" : "未安装",
        chipClass: "neutral"
      };
    case "installed_but_broken":
      return {
        label: english ? "Broken" : "环境异常",
        chipClass: "error"
      };
    case "service_unavailable":
      return {
        label: english ? "Service offline" : "服务未启动",
        chipClass: "error"
      };
    default:
      return {
        label: english ? "Unavailable" : "暂不可用",
        chipClass: "warning"
      };
  }
}
