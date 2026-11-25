/**
 * Public identity of the Kadam implementation.
 *
 * The language version and the implementation version evolve independently:
 * a compiler release may add features, fix diagnostics, or improve generated
 * output without changing the language grammar.
 */
export const KADAM_VERSION = "0.1.0";
export const LANGUAGE_VERSION = "0.1";
export const CORE_LANGUAGE_VERSION = "0.2";

/**
 * Declarative UI language versions this compiler accepts, oldest first.
 * `0.2` is deliberately absent: it names the general-purpose core module
 * language (`CORE_LANGUAGE_VERSION`). UI syntax added after 0.1 ships under
 * `0.3`; a 0.1 file keeps its exact meaning and byte-identical output.
 */
export const UI_LANGUAGE_VERSIONS = ["0.1", "0.3"] as const;
export type UiLanguageVersion = (typeof UI_LANGUAGE_VERSIONS)[number];

/** The newest UI version; used by tooling that wants the full vocabulary. */
export const LATEST_UI_LANGUAGE_VERSION: UiLanguageVersion = "0.3";

export function isUiLanguageVersion(value: unknown): value is UiLanguageVersion {
  return (UI_LANGUAGE_VERSIONS as readonly unknown[]).includes(value);
}

/** True when `version` includes everything introduced in `required`. */
export function uiVersionAtLeast(
  version: UiLanguageVersion,
  required: UiLanguageVersion,
): boolean {
  return UI_LANGUAGE_VERSIONS.indexOf(version) >= UI_LANGUAGE_VERSIONS.indexOf(required);
}
