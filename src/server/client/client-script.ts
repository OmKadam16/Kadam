/**
 * Browser client for the Kadam development server.
 *
 * Authored as a string so the package needs no asset-copy build step and the
 * project's TypeScript configuration does not need DOM types. It contains no
 * user data, and every dynamic value is written with `textContent`.
 */
export const CLIENT_SCRIPT = String.raw`(function () {
  "use strict";

  var overlay = null;
  var list = null;
  var subtitle = null;
  var badge = null;
  var banner = null;
  var originalTitle = document.title;
  var currentBuild = 0;
  var dismissedBuild = -1;

  function ensureOverlay() {
    if (overlay !== null) return;
    // Pages link only their own stylesheets; the overlay brings its own.
    if (document.querySelector('link[href="/__kadam/client.css"]') === null) {
      var style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = "/__kadam/client.css";
      document.head.appendChild(style);
    }
    overlay = document.createElement("div");
    overlay.id = "kadam-overlay";
    overlay.setAttribute("role", "alert");
    overlay.setAttribute("aria-live", "polite");
    overlay.tabIndex = -1;
    overlay.hidden = true;

    var header = document.createElement("div");
    header.className = "kadam-overlay-header";

    var title = document.createElement("h2");
    title.className = "kadam-overlay-title";
    title.textContent = "Kadam build errors";

    var dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "kadam-overlay-dismiss";
    dismiss.textContent = "Dismiss";
    dismiss.setAttribute("aria-label", "Dismiss build errors");
    dismiss.addEventListener("click", function () {
      dismissedBuild = currentBuild;
      overlay.hidden = true;
    });

    subtitle = document.createElement("p");
    subtitle.className = "kadam-overlay-subtitle";

    header.appendChild(title);
    header.appendChild(dismiss);

    list = document.createElement("ul");
    list.className = "kadam-overlay-list";

    overlay.appendChild(header);
    overlay.appendChild(subtitle);
    overlay.appendChild(list);
    document.body.appendChild(overlay);

    overlay.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        dismissedBuild = currentBuild;
        overlay.hidden = true;
      }
    });
  }

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch (error) {
      // Clipboard access is optional.
    }
  }

  function renderList(diagnostics) {
    while (list.firstChild) list.removeChild(list.firstChild);
    var limit = Math.min(diagnostics.length, 100);
    for (var index = 0; index < limit; index += 1) {
      var diagnostic = diagnostics[index];
      var item = document.createElement("li");
      item.className = "kadam-overlay-item";

      var message = document.createElement("div");
      message.className = "kadam-overlay-message";

      var code = document.createElement("span");
      code.className = "kadam-overlay-code";
      code.textContent = diagnostic.code;

      var text = document.createElement("span");
      text.className = "kadam-overlay-text";
      text.textContent = diagnostic.message;

      message.appendChild(code);
      message.appendChild(text);

      var location = document.createElement("button");
      location.type = "button";
      location.className = "kadam-overlay-location";
      location.textContent =
        diagnostic.file + ":" + diagnostic.line + ":" + diagnostic.column;
      location.setAttribute(
        "aria-label",
        "Copy location " + location.textContent
      );
      location.addEventListener("click", function (event) {
        copy(event.currentTarget.textContent);
      });

      item.appendChild(message);
      item.appendChild(location);

      if (diagnostic.hint) {
        var hint = document.createElement("div");
        hint.className = "kadam-overlay-hint";
        hint.textContent = diagnostic.hint;
        item.appendChild(hint);
      }

      list.appendChild(item);
    }
    if (diagnostics.length > limit) {
      var more = document.createElement("li");
      more.className = "kadam-overlay-item";
      more.textContent =
        "and " + (diagnostics.length - limit) + " more (see terminal)";
      list.appendChild(more);
    }
  }

  function errorsOf(status) {
    return (status.diagnostics || []).filter(function (diagnostic) {
      return diagnostic.severity === "error";
    });
  }

  function showOverlay(status) {
    ensureOverlay();
    var errors = errorsOf(status);
    renderList(errors);
    var count = errors.length;
    subtitle.textContent =
      count +
      (count === 1 ? " error" : " errors") +
      " \u00b7 " +
      (status.served === "last-success"
        ? "showing the last successful preview"
        : "no successful build yet");
    overlay.hidden = false;
    try {
      overlay.focus();
    } catch (error) {
      // Focus is best effort.
    }
  }

  function hideOverlay() {
    if (overlay !== null) overlay.hidden = true;
  }

  var warnedBuild = -1;

  function applyStatus(status) {
    currentBuild = status.buildId;
    // Only errors stop a build; warnings go to the console and the terminal.
    if (status.phase === "failure" && errorsOf(status).length > 0) {
      document.title = "\u25cf " + originalTitle;
      if (dismissedBuild !== status.buildId) showOverlay(status);
    } else {
      document.title = originalTitle;
      hideOverlay();
      var warnings = (status.diagnostics || []).filter(function (diagnostic) {
        return diagnostic.severity !== "error";
      });
      if (warnings.length > 0 && warnedBuild !== status.buildId) {
        warnedBuild = status.buildId;
        console.warn("Kadam: " + warnings.length + (warnings.length === 1 ? " warning" : " warnings") + " (see the terminal)");
      }
    }
  }

  function ensureBadge() {
    if (badge !== null) return;
    badge = document.createElement("div");
    badge.id = "kadam-badge";
    badge.textContent = "Kadam: reconnecting\u2026";
    badge.hidden = true;
    document.body.appendChild(badge);
  }

  function setBadge(visible) {
    ensureBadge();
    badge.hidden = !visible;
  }

  function showStopped() {
    if (banner !== null) return;
    banner = document.createElement("div");
    banner.id = "kadam-banner";
    banner.textContent =
      "Kadam dev server stopped. Restart kadam dev to continue.";
    document.body.appendChild(banner);
  }

  function swapStylesheet(href, buildId) {
    var target;
    try {
      target = new URL(href, location.origin);
    } catch (error) {
      return;
    }
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var index = 0; index < links.length; index += 1) {
      var link = links[index];
      var current;
      try {
        current = new URL(link.href, location.origin);
      } catch (error) {
        continue;
      }
      if (current.pathname === target.pathname) {
        link.href = target.pathname + "?kadam=" + buildId;
      }
    }
  }

  function connect() {
    var source;
    try {
      source = new EventSource("/__kadam/events");
    } catch (error) {
      return;
    }

    source.addEventListener("status", function (event) {
      var status;
      try {
        status = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      applyStatus(status);
    });

    source.addEventListener("css", function (event) {
      var payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      currentBuild = payload.buildId;
      var hrefs = payload.hrefs || [];
      for (var index = 0; index < hrefs.length; index += 1) {
        swapStylesheet(hrefs[index], payload.buildId);
      }
    });

    source.addEventListener("reload", function () {
      location.reload();
    });

    source.addEventListener("shutdown", function () {
      try {
        source.close();
      } catch (error) {
        // Already closed.
      }
      showStopped();
    });

    source.onopen = function () {
      setBadge(false);
    };
    source.onerror = function () {
      setBadge(true);
    };
  }

  ensureOverlay();
  connect();
})();`;
