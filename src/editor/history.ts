import type { SourceDocument } from "./source-document.js";

/**
 * Undo/redo history for one source document.
 *
 * History stores committed text snapshots, not entire documents. Undo and redo
 * therefore preserve the current saved baseline, newline style, BOM, and path
 * while assigning a fresh document version.
 */
export class SourceHistory {
  readonly #texts: string[];
  #document: SourceDocument;
  #index = 0;

  constructor(initial: SourceDocument) {
    this.#document = initial;
    this.#texts = [initial.text];
  }

  get document(): SourceDocument {
    return this.#document;
  }

  get canUndo(): boolean {
    return this.#index > 0;
  }

  get canRedo(): boolean {
    return this.#index < this.#texts.length - 1;
  }

  get undoDepth(): number {
    return this.#index;
  }

  get redoDepth(): number {
    return this.#texts.length - 1 - this.#index;
  }

  /**
   * Record a committed document. Saving a clean buffer updates the current
   * document and saved baseline without creating an undo entry.
   */
  commit(next: SourceDocument): void {
    if (next.path !== this.#document.path) {
      throw new Error(
        `cannot commit '${next.path}' to history for '${this.#document.path}'`,
      );
    }

    const previous = this.#document;
    this.#document = next;
    if (next.text === previous.text) return;

    this.#texts.length = this.#index + 1;
    this.#texts.push(next.text);
    this.#index += 1;
  }

  undo(): SourceDocument | null {
    if (!this.canUndo) return null;
    this.#index -= 1;
    return this.#restore(this.#texts[this.#index]!);
  }

  redo(): SourceDocument | null {
    if (!this.canRedo) return null;
    this.#index += 1;
    return this.#restore(this.#texts[this.#index]!);
  }

  #restore(text: string): SourceDocument {
    const current = this.#document;
    this.#document = {
      ...current,
      text,
      version: current.version + 1,
      dirty: text !== current.savedText,
    };
    return this.#document;
  }
}
