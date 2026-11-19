const AUTO_MOUNT_FLAG = Symbol.for("openui.devtools.autoMount");
(globalThis as Record<symbol, unknown>)[AUTO_MOUNT_FLAG] = true;

if (typeof document !== "undefined") {
  for (const host of document.querySelectorAll("[data-openui-devtools-auto-mount]")) {
    host.remove();
  }
}
