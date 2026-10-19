export function createTeamCatalogUseCases({ teamCatalog }) {
  if (!teamCatalog || typeof teamCatalog.listTeamFactory !== "function" || typeof teamCatalog.listTeamRepository !== "function") {
    throw new TypeError("Team catalog use cases require a team catalog port.");
  }

  return Object.freeze({
    listTeamFactory: () => teamCatalog.listTeamFactory(),
    async queryTeamRepository({ query = "", category = "", status = "released", sort = "updated", page = 1, pageSize = 12 } = {}) {
      const allTeams = await teamCatalog.listTeamRepository({ includeUnreleased: true });
      const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
      const normalizedCategory = String(category || "").trim().toLocaleLowerCase();
      const normalizedStatus = String(status || "").trim().toLocaleLowerCase();
      const filtered = allTeams.filter((team) => {
        const teamStatus = String(team.teamVersionStatus || "released").toLocaleLowerCase();
        const teamCategory = typeof team.category === "object" ? (team.category["zh-CN"] || team.category.en || "") : (team.category || "");
        const haystack = [team.teamName, team.name, team.overview, teamCategory].join(" ").toLocaleLowerCase();
        return (!normalizedQuery || haystack.includes(normalizedQuery))
          && (!normalizedCategory || String(teamCategory).toLocaleLowerCase() === normalizedCategory)
          && (!normalizedStatus || normalizedStatus === "all" || teamStatus === normalizedStatus);
      }).sort((left, right) => {
        if (sort === "name") return String(left.teamName || left.name).localeCompare(String(right.teamName || right.name), "zh-CN");
        if (sort === "version") return (right.teamVersionNumber || 0) - (left.teamVersionNumber || 0) || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
        return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
      });
      const safePageSize = Math.max(1, Math.min(50, Number.parseInt(pageSize, 10) || 12));
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / safePageSize));
      const safePage = Math.max(1, Math.min(totalPages, Number.parseInt(page, 10) || 1));
      const categoryName = (team) => typeof team.category === "object" ? (team.category["zh-CN"] || team.category.en || "未分类") : (team.category || "未分类");
      const stats = {
        total: allTeams.length,
        released: allTeams.filter((team) => team.teamVersionStatus === "released").length,
        builtIn: allTeams.filter((team) => team.builtIn).length,
        custom: allTeams.filter((team) => !team.builtIn).length,
        categories: Object.fromEntries([...new Set(allTeams.map(categoryName))].sort().map((item) => [item, allTeams.filter((team) => categoryName(team) === item).length]))
      };
      return {
        teams: filtered.slice((safePage - 1) * safePageSize, safePage * safePageSize),
        stats,
        pagination: { page: safePage, pageSize: safePageSize, total, totalPages }
      };
    }
  });
}
