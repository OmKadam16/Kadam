import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const HOME_PAGE = `kadam 0.1

page "Home" {
    headline1 {
        a main heading
        the text says "Home page"
        the text is 40px
    }

    aboutLink1 {
        a link
        the link text says "About"
        when clicked, go to page "About"
    }
}
`;

export const ABOUT_PAGE = `kadam 0.1

page "About" {
    headline1 {
        a main heading
        the text says "About page"
    }

    homeLink1 {
        a link
        the link text says "Home"
        when clicked, go to page "Home"
    }
}
`;

export const LOGO = '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n';

export function manifestFor(pages, extra = {}) {
  return { kadam: "0.1", name: "DevProject", pages, ...extra };
}

export function createProject(files, manifest) {
  const projectRoot = mkdtempSync(join(tmpdir(), "kadam-dev-"));
  if (manifest !== undefined) {
    writeFileSync(
      join(projectRoot, "kadam.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }
  for (const [path, contents] of Object.entries(files)) {
    writeProjectFile(projectRoot, path, contents);
  }
  return projectRoot;
}

export function writeProjectFile(projectRoot, path, contents) {
  const target = join(projectRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

export function standardProject(extra = {}) {
  return createProject(
    {
      "pages/home.kdm": HOME_PAGE,
      "pages/about.kdm": ABOUT_PAGE,
      "assets/logo.svg": LOGO,
    },
    manifestFor(
      [
        { title: "Home", source: "pages/home.kdm", route: "/" },
        { title: "About", source: "pages/about.kdm", route: "/about" },
      ],
      extra,
    ),
  );
}
