import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import arrowSvg from "@phosphor-icons/core/regular/arrow-right.svg?raw";
import arrowLeftSvg from "@phosphor-icons/core/regular/arrow-left.svg?raw";
import checkSvg from "@phosphor-icons/core/regular/check.svg?raw";
import closeSvg from "@phosphor-icons/core/regular/x.svg?raw";
import dotsSvg from "@phosphor-icons/core/regular/dots-three.svg?raw";
import downloadSvg from "@phosphor-icons/core/regular/download-simple.svg?raw";
import imageSvg from "@phosphor-icons/core/regular/image.svg?raw";
import infoSvg from "@phosphor-icons/core/regular/info.svg?raw";
import lockSvg from "@phosphor-icons/core/regular/lock-key.svg?raw";
import pauseSvg from "@phosphor-icons/core/regular/pause.svg?raw";
import playSvg from "@phosphor-icons/core/regular/play.svg?raw";
import plusSvg from "@phosphor-icons/core/regular/plus.svg?raw";
import searchSvg from "@phosphor-icons/core/regular/magnifying-glass.svg?raw";
import shareSvg from "@phosphor-icons/core/regular/share-network.svg?raw";
import sparkSvg from "@phosphor-icons/core/regular/sparkle.svg?raw";
import userSvg from "@phosphor-icons/core/regular/user-circle.svg?raw";
import warningSvg from "@phosphor-icons/core/regular/warning.svg?raw";

/** Semantic product names, independent of upstream filenames and icon weights. */
export type FormaIconName =
  | "admin" | "arrow" | "audio" | "back" | "bold" | "branch" | "bullets" | "check"
  | "clock" | "close" | "collapse" | "compare" | "contrast" | "copy"
  | "dashboard" | "document" | "dots" | "down" | "download" | "draw"
  | "edit" | "expand" | "eye" | "families" | "flask" | "focal-point"
  | "folder" | "grid" | "heading" | "hidden" | "home" | "image" | "info"
  | "italic" | "layers" | "link" | "lock" | "marquee" | "menu" | "minus"
  | "next" | "numbered" | "open" | "palette" | "pan" | "pause" | "pin" | "play"
  | "plus" | "previous" | "quote" | "redo" | "replay" | "save" | "scene"
  | "scope" | "search" | "select" | "selection" | "send" | "share"
  | "slides" | "spark" | "step" | "story" | "storyboard" | "swap"
  | "trash" | "undo" | "unlock" | "up" | "user" | "video" | "warning";

export type FormaIconDefinitions = Readonly<Partial<Record<FormaIconName, string>>>;

const definitions = new Map<FormaIconName, string>();

/**
 * Register only statically bundled, trusted Phosphor Regular SVG assets.
 * Feature packs call this synchronously when their existing route chunk loads.
 */
export function registerIcons(icons: FormaIconDefinitions): void {
  for (const [name, source] of Object.entries(icons)) {
    if (!source) continue;
    definitions.set(
      name as FormaIconName,
      source.replace("<svg ", '<svg aria-hidden="true" focusable="false" width="20" height="20" '),
    );
  }
}

// Keep the eager shell vocabulary intentionally small. Route-only symbols live
// in synchronously registered, statically imported feature packs.
registerIcons({
  arrow: arrowSvg,
  back: arrowLeftSvg,
  check: checkSvg,
  close: closeSvg,
  dots: dotsSvg,
  download: downloadSvg,
  image: imageSvg,
  info: infoSvg,
  lock: lockSvg,
  next: arrowSvg,
  open: arrowSvg,
  pause: pauseSvg,
  play: playSvg,
  plus: plusSvg,
  previous: arrowLeftSvg,
  search: searchSvg,
  share: shareSvg,
  spark: sparkSvg,
  user: userSvg,
  warning: warningSvg,
});

/** Decorative, synchronously rendered product icon; controls own their name. */
export function icon(name: FormaIconName | (string & {})) {
  const source = definitions.get(name as FormaIconName) ?? definitions.get("info")!;
  // Every source is a trusted, build-time SVG import; user content never enters.
  return html`<span class="forma-icon" aria-hidden="true">${unsafeHTML(source)}</span>`;
}
