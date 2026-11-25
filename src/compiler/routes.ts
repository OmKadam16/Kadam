/**
 * Deterministic naming and path rules shared by lowering and the emitters.
 * Routes are the only input; nothing here depends on the machine or locale.
 */

export function normalizeRoute(route: string): string {
  const withLeadingSlash = route.startsWith("/") ? route : `/${route}`;
  if (withLeadingSlash === "/") return "/";
  return `${withLeadingSlash.replace(/\/+$/, "")}/`;
}

export function routeSlug(route: string): string {
  const normalized = normalizeRoute(route);
  if (normalized === "/") return "home";
  return normalized
    .slice(1, -1)
    .split("/")
    .join("-");
}

export function routeOutputPath(route: string): string {
  const normalized = normalizeRoute(route);
  if (normalized === "/") return "index.html";
  return `${normalized.slice(1)}index.html`;
}

export function normalizeBasePath(basePath: string = ""): string {
  if (!basePath || basePath === "/") return "";
  const withLeading = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withLeading.replace(/\/+$/, "");
}

export function routeUrl(route: string, basePath: string = ""): string {
  const normalizedRoute = normalizeRoute(route);
  const normalizedBase = normalizeBasePath(basePath);
  if (!normalizedBase) return normalizedRoute;
  if (normalizedRoute === "/") return `${normalizedBase}/`;
  return `${normalizedBase}${normalizedRoute}`;
}

export function pageCssFileName(slug: string): string {
  return `kadam.${slug}.css`;
}

export function pageCssHref(slug: string, basePath: string = ""): string {
  const normalizedBase = normalizeBasePath(basePath);
  const file = pageCssFileName(slug);
  return normalizedBase ? `${normalizedBase}/assets/${file}` : `/assets/${file}`;
}

export function baseCssHref(basePath: string = ""): string {
  const normalizedBase = normalizeBasePath(basePath);
  return normalizedBase ? `${normalizedBase}/assets/kadam.css` : "/assets/kadam.css";
}

/**
 * Normalizes a project-relative asset reference into a portable output path.
 * Returns null when the reference is absolute or escapes the project root.
 */
export function normalizeAssetPath(sourcePath: string): string | null {
  const unified = sourcePath.replaceAll("\\", "/");
  if (unified === "" || unified.startsWith("/") || /^[A-Za-z]:/.test(unified)) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }

  return segments.length === 0 ? null : segments.join("/");
}

/** Project-root-relative asset paths become root-relative, URL-safe paths. */
export function assetUrl(sourcePath: string, basePath: string = ""): string {
  const normalized = normalizeAssetPath(sourcePath);
  const withoutDot =
    normalized ?? sourcePath.replaceAll("\\", "/").replace(/^\.?\/+/, "");
  const normalizedBase = normalizeBasePath(basePath);
  const pathPart = encodeURI(`/${withoutDot}`);
  return normalizedBase ? `${normalizedBase}${pathPart}` : pathPart;
}

/**
 * Calculates a relative directory path between two normalized routes.
 * e.g. from "/about/" to "/" is "../", from "/" to "/about/" is "about/".
 */
export function relativePathBetweenRoutes(fromRoute: string, toRoute: string): string {
  const fromNormalized = normalizeRoute(fromRoute);
  const toNormalized = normalizeRoute(toRoute);
  if (fromNormalized === toNormalized) return "./";

  const fromSegments = fromNormalized.slice(1, -1).split("/").filter(Boolean);
  const toSegments = toNormalized.slice(1, -1).split("/").filter(Boolean);

  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length &&
    fromSegments[common] === toSegments[common]
  ) {
    common++;
  }

  const up = fromSegments.length - common;
  const upParts = new Array(up).fill("..");
  const downParts = toSegments.slice(common);
  const allParts = [...upParts, ...downParts];
  if (allParts.length === 0) return "./";
  return `${allParts.join("/")}/`;
}
