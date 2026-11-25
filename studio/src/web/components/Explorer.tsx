import type { TreeEntry } from "../../shared/protocol.js";

interface ExplorerProps {
  readonly entries: readonly TreeEntry[];
  readonly activePath: string | null;
  readonly onOpen: (path: string, route?: string) => void;
}

export function Explorer({ entries, activePath, onOpen }: ExplorerProps) {
  const pages = entries.filter((entry) => entry.kind === "page");
  const components = entries.filter((entry) => entry.kind === "component");

  return (
    <section className="panel explorer">
      <header className="panel-header">
        <h2>Project</h2>
        <span className="count">{entries.length}</span>
      </header>
      <div className="panel-scroll">
        <FileGroup
          title="Pages"
          entries={pages}
          activePath={activePath}
          onOpen={onOpen}
        />
        <FileGroup
          title="Components"
          entries={components}
          activePath={activePath}
          onOpen={onOpen}
        />
        {entries.length === 0 ? (
          <p className="empty">No .kdm source files were found.</p>
        ) : null}
      </div>
    </section>
  );
}

interface FileGroupProps {
  readonly title: string;
  readonly entries: readonly TreeEntry[];
  readonly activePath: string | null;
  readonly onOpen: (path: string, route?: string) => void;
}

function FileGroup({ title, entries, activePath, onOpen }: FileGroupProps) {
  if (entries.length === 0) return null;
  return (
    <div className="file-group">
      <h3>{title}</h3>
      <ul className="file-list">
        {entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className={`file-row${entry.path === activePath ? " is-active" : ""}`}
              title={entry.path}
              onClick={() => onOpen(entry.path, entry.route)}
            >
              <span className="file-name">{entry.label}</span>
              {entry.route === undefined ? null : (
                <span className="file-route">{entry.route}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
