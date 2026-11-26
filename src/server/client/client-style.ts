/** Stylesheet for the development overlay, badge, and static dev pages. */
export const CLIENT_STYLE = `/* Kadam development server. Not part of generated site output. */
#kadam-overlay {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483000;
  width: min(720px, calc(100vw - 32px));
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #3f1d1d;
  border-radius: 10px;
  background: #1b1111;
  color: #f5e9e9;
  box-shadow: 0 18px 40px rgb(0 0 0 / 0.45);
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

#kadam-overlay[hidden] {
  display: none;
}

.kadam-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #4a2626;
  background: #2a1717;
}

.kadam-overlay-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.kadam-overlay-dismiss {
  border: 1px solid #6b3a3a;
  border-radius: 6px;
  padding: 4px 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.kadam-overlay-dismiss:hover,
.kadam-overlay-dismiss:focus-visible {
  background: #402020;
  outline: 2px solid #f0a0a0;
  outline-offset: 2px;
}

.kadam-overlay-subtitle {
  margin: 0;
  padding: 8px 16px 0;
  color: #d4a7a7;
}

.kadam-overlay-list {
  margin: 0;
  padding: 8px 16px 16px;
  overflow: auto;
  list-style: none;
}

.kadam-overlay-item {
  padding: 10px 0;
  border-top: 1px solid #35201f;
}

.kadam-overlay-item:first-child {
  border-top: 0;
}

.kadam-overlay-message {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.kadam-overlay-code {
  flex: none;
  color: #ffb4b4;
  font-weight: 700;
}

.kadam-overlay-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.kadam-overlay-location {
  margin-top: 4px;
  border: 0;
  padding: 0;
  background: transparent;
  color: #9ecbff;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.kadam-overlay-hint {
  margin-top: 4px;
  color: #c9b8a8;
  white-space: pre-wrap;
}

#kadam-badge {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  padding: 6px 12px;
  border-radius: 999px;
  background: #1e293b;
  color: #e2e8f0;
  font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.25);
}

#kadam-source {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: #1e293b;
  color: #e2e8f0;
  font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.25);
}

#kadam-source[hidden] {
  display: none;
}

#kadam-source button,
#kadam-source a {
  font: inherit;
  color: #93c5fd;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
}

#kadam-badge[hidden] {
  display: none;
}

#kadam-banner {
  position: fixed;
  inset: 0 0 auto;
  z-index: 2147483000;
  padding: 10px 16px;
  background: #111827;
  color: #f9fafb;
  text-align: center;
  font: 13px/1.5 ui-sans-serif, system-ui, sans-serif;
}

.kadam-static {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
  font: 16px/1.6 ui-sans-serif, system-ui, sans-serif;
  color: #171717;
}

.kadam-static h1 {
  margin: 0 0 8px;
  font-size: 32px;
}

.kadam-static ul {
  padding-left: 20px;
}

.kadam-static a {
  color: #2563eb;
}
`;
