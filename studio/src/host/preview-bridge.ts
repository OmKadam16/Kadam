/**
 * Development-only script injected into preview HTML by the Studio proxy.
 *
 * The bridge only turns a click on `[data-kdm-id]` into a narrow selection
 * message. It never accepts source paths, HTML, CSS, or file contents, and it
 * is never part of production output.
 */
export const PREVIEW_BRIDGE_SCRIPT = String.raw`(() => {
  "use strict";
  if (window.parent === window) return;

  var SELECT = "select";
  var INTERACT = "interact";
  var mode = SELECT;

  function closestNode(target) {
    var element = target instanceof Element ? target : null;
    return element === null ? null : element.closest("[data-kdm-id]");
  }

  function currentRoute() {
    var path = window.location.pathname;
    var base = "/__preview";
    if (path === base) return "/";
    if (path.indexOf(base + "/") === 0) path = path.slice(base.length);
    return path === "" ? "/" : path;
  }

  function post(type, detail) {
    var message = { type: type };
    if (detail) {
      for (var key in detail) {
        if (Object.prototype.hasOwnProperty.call(detail, key)) {
          message[key] = detail[key];
        }
      }
    }
    window.parent.postMessage(message, window.location.origin);
  }

  document.addEventListener("click", function (event) {
    if (mode !== SELECT) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    var node = closestNode(event.target);
    if (node === null) return;
    var nodeId = node.getAttribute("data-kdm-id");
    if (nodeId === null || nodeId === "") return;
    event.preventDefault();
    event.stopPropagation();
    post("kadam-studio:select", {
      nodeId: nodeId,
      route: currentRoute(),
      url: window.location.href
    });
  }, true);

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "kadam-studio:mode") {
      mode = data.mode === INTERACT ? INTERACT : SELECT;
    }
  });

  post("kadam-studio:ready", { route: currentRoute() });
})();`;
