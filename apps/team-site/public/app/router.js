export function createRouter({ syncRoute, canLeave = () => true }) {
  let currentPath = `${location.pathname}${location.search}${location.hash}`;
  let pending = false;
  const navigate = async (path) => {
    const nextPath = String(path);
    if (nextPath === currentPath || pending) return false;
    pending = true;
    try {
      if (!await canLeave(nextPath)) return false;
      history.pushState({}, "", nextPath);
      currentPath = `${location.pathname}${location.search}${location.hash}`;
      syncRoute();
      window.scrollTo({ top: 0, behavior: "instant" });
      return true;
    } finally {
      pending = false;
    }
  };
  const install = () => {
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-route]");
      if (!link) return;
      event.preventDefault();
      navigate(link.getAttribute("href"));
    });
    window.addEventListener("popstate", async () => {
      const nextPath = `${location.pathname}${location.search}${location.hash}`;
      if (pending) return;
      pending = true;
      try {
        if (await canLeave(nextPath)) {
          currentPath = nextPath;
          syncRoute();
        } else {
          history.pushState({}, "", currentPath);
        }
      } finally {
        pending = false;
      }
    });
  };
  return { install, navigate };
}
