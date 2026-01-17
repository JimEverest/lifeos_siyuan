import type { Plugin } from "siyuan";

export function createStatusBar(plugin?: Plugin): HTMLElement {
  const el = document.createElement("span");
  el.className = "lifeos-sync-status";
  el.textContent = "";

  if (plugin && typeof (plugin as any).addStatusBar === "function") {
    (plugin as any).addStatusBar({ element: el });
    return el;
  }

  const host = document.querySelector("#status") || document.querySelector(".status");
  if (host) {
    host.appendChild(el);
    return el;
  }

  document.body.appendChild(el);
  return el;
}

export function updateStatusBar(el: HTMLElement | null, message: string): void {
  if (!el) {
    return;
  }
  el.textContent = message;
}
