export function repositoryFullNameFromUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : null;
}

export function buildProductRepositoryIndex(catalog) {
  const index = new Map();
  for (const product of catalog?.products ?? []) {
    const fullName = repositoryFullNameFromUrl(product.repository);
    if (!fullName) continue;
    if (index.has(fullName)) {
      throw new Error(`Duplicate catalog repository mapping: ${fullName}`);
    }
    index.set(fullName, product);
  }
  return index;
}

export function resolveRepositoryFilter(search, repositories) {
  const configured = new Set(
    repositories.map((repository) => repository.fullName)
  );
  const requested = new URLSearchParams(search).get("repository") ?? "";
  return configured.has(requested) ? requested : "";
}

export function resolveSearchFilter(search) {
  return new URLSearchParams(search).get("q") ?? "";
}

export function buildWorkQuery({ repository = "", search = "" } = {}) {
  const params = new URLSearchParams();
  if (repository) params.set("repository", repository);
  if (search.trim()) params.set("q", search.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}
