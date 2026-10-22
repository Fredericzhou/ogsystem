export function createRouter({ syncRoute, canLeave = () => true, onRouteChange = () => {} }) {
  const canonicalize = (value) => {
    const url = new URL(String(value), location.origin);
    const path = url.pathname.replace(/\/$/, "") || "/";
    return `${path}${url.search}${url.hash}`;
  };
  let currentPath = `${location.pathname}${location.search}${location.hash}`;
  let pending = false;
  const readPath = () => `${location.pathname}${location.search}${location.hash}`;
  const navigate = async (path) => {
    const nextPath = canonicalize(path);
    if (nextPath === currentPath || pending) return false;
    pending = true;
    try {
      if (!await canLeave(nextPath)) return false;
      history.pushState({}, "", nextPath);
      currentPath = readPath();
      onRouteChange(currentPath);
      syncRoute();
      window.scrollTo({ top: 0, behavior: "instant" });
      return true;
    } finally {
      pending = false;
    }
  };
  const install = () => {
    const initial = readPath();
    const canonical = canonicalize(initial === "/" ? "/projects" : initial);
    if (canonical !== initial) {
      history.replaceState({}, "", canonical);
      currentPath = canonical;
      onRouteChange(currentPath);
      syncRoute();
    }
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-route]");
      if (!link) return;
      event.preventDefault();
      navigate(link.getAttribute("href"));
    });
    window.addEventListener("popstate", async () => {
      const nextPath = `${location.pathname}${location.search}${location.hash}`;
      const canonical = canonicalize(nextPath);
      if (canonical !== nextPath) {
        history.replaceState({}, "", canonical);
        currentPath = canonical;
        syncRoute();
        return;
      }
      if (pending) return;
      pending = true;
      try {
        if (await canLeave(nextPath)) {
          currentPath = nextPath;
          onRouteChange(currentPath);
          syncRoute();
        } else {
          history.pushState({}, "", currentPath);
        }
      } finally {
        pending = false;
      }
    });
  };
  const syncCurrentPath = () => {
    currentPath = readPath();
    return currentPath;
  };
  return { install, navigate, syncCurrentPath };
}
