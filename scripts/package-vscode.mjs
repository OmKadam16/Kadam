// Packages editors/vscode as a .vsix (a zip with a manifest) without any
// dependencies, using the system `zip` command.
//   node scripts/package-vscode.mjs        -> editors/vscode/kadam-<version>.vsix
// Install it with: code --install-extension editors/vscode/kadam-<version>.vsix
// Publishing to the Marketplace needs your own publisher account and token:
//   npx @vscode/vsce publish --packagePath editors/vscode/kadam-<version>.vsix
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve("editors/vscode");
const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
const FILES = ["package.json", "extension.js", "client.js", "language-configuration.json", "README.md", "CHANGELOG.md", "syntaxes/kadam.tmLanguage.json"];

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stage = mkdtempSync(join(tmpdir(), "kadam-vsix-"));
mkdirSync(join(stage, "extension", "syntaxes"), { recursive: true });
for (const file of FILES) cpSync(join(source, file), join(stage, "extension", file));
cpSync(join(source, "LICENSE"), join(stage, "extension", "LICENSE.txt"));

writeFileSync(join(stage, "[Content_Types].xml"), `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".txt" ContentType="text/plain"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
`);
writeFileSync(join(stage, "extension.vsixmanifest"), `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escape(manifest.name)}" Version="${escape(manifest.version)}" Publisher="${escape(manifest.publisher)}" />
    <DisplayName>${escape(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${escape(manifest.description)}</Description>
    <Tags>${escape(manifest.keywords.join(","))}</Tags>
    <Categories>${escape(manifest.categories.join(","))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escape(manifest.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>
`);
const out = join(source, `${manifest.name}-${manifest.version}.vsix`);
rmSync(out, { force: true });
execFileSync("zip", ["-q", "-X", "-r", out, "[Content_Types].xml", "extension.vsixmanifest", "extension"], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`wrote ${out}`);
