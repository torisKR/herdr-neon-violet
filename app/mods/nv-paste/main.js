// Ctrl+V (Windows/Linux) and Cmd+V (macOS) in a terminal, so a screenshot reaches Claude Code and
// Codex. A clipboard holding only an image becomes a PNG file under ~/.config/herdr-app/paste and is
// pasted as a dropped file (its path; Herdr copies it to another machine when the terminal is there),
// which the agents attach as an image. Text and copied files paste as before.
// On Windows Herdr's own Ctrl+V pastes clipboard text and passes Ctrl+V on (Codex reads an image itself,
// Claude Code does not); on macOS the image depended on the program reading the clipboard itself.
import { View, div } from "gpui-kit";
import { agents, appHome, checking, closeOverlay, exec, focused, props, run, terminals, window } from "herdr";

// Windows PowerShell: what the clipboard holds; an image alone is saved and offered as a file too.
const WINDOWS = `param($out)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$c = [Windows.Forms.Clipboard]
if ($c::ContainsText()) { 'text'; exit }
if ($c::ContainsFileDropList()) { 'files'; exit }
$img = $c::GetImage()
if (-not $img) { 'none'; exit }
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$img.Save($out, [Drawing.Imaging.ImageFormat]::Png)
$d = New-Object Windows.Forms.DataObject
$d.SetImage($img)
$files = New-Object Collections.Specialized.StringCollection
[void]$files.Add($out)
$d.SetFileDropList($files)
$c::SetDataObject($d, $true)
'image'`;

// macOS (JavaScript for Automation), same answers; the clipboard then holds the PNG file and the
// image, so other apps still paste a picture. (AppleScript's `set the clipboard to POSIX file` left it empty.)
const MACOS = `function run(argv) {
  ObjC.import("AppKit");
  const out = argv[0];
  const pb = $.NSPasteboard.generalPasteboard;
  const types = ObjC.deepUnwrap(pb.types) || [];
  if (types.includes("public.file-url")) return "files";
  if (types.includes("public.utf8-plain-text")) return "text";
  let data = pb.dataForType("public.png");
  if (data.isNil()) {
    const tiff = pb.dataForType("public.tiff");
    if (tiff.isNil()) return "none";
    data = $.NSBitmapImageRep.imageRepWithData(tiff).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  }
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(out).stringByDeletingLastPathComponent, true, $(), $());
  if (!data.writeToFileAtomically(out, true)) return "none";
  const item = $.NSPasteboardItem.alloc.init;
  item.setStringForType($.NSURL.fileURLWithPath(out).absoluteString, "public.file-url");
  item.setDataForType(data, "public.png");
  pb.clearContents;
  pb.writeObjects($([item]));
  return "image";
}`;

/** How a press is handled on this platform, for a terminal here or on another machine, running app.
 *  On Windows Herdr's Ctrl+V pastes text, and with no text passes Ctrl+V to the program: Codex then
 *  reads the image itself, so a file paste would add it twice. Claude Code (Alt+V there) and others
 *  need the file. Checking the clipboard first would slow every text paste (~0.7 s of PowerShell). */
function plan(platform, remote, app) {
  if (platform === "windows") return remote || /codex/i.test(app ?? "") ? "native" : "windows";
  if (platform === "macos") return "macos";
  return "native";
}

/** The program in a terminal (agents report theirs; others by the program table). */
function appOf(address) {
  if (!address) return null;
  const a = agents().find(x => x.address === address);
  if (a) return a.app ?? a.program?.key ?? null;
  const t = terminals().find(x => x.address === address);
  return t?.report?.app ?? t?.program?.key ?? null;
}

export default class Paste extends View {
  init(_props, cx) {
    // Read focus before anything: the popup this runs in must not count as the place to paste.
    // Paste commands follow the focused terminal (a popup isn't one). The 1px popup stays until
    // the work is done, because closing a mod cancels its pending work.
    const f = focused();
    const overlay = props()?.overlay;
    const done = () => { if (overlay) closeOverlay(overlay); };
    if (checking()) return done();
    const platform = window().platform;
    const remote = Boolean(f?.terminal?.includes("/"));
    const file = `${appHome()}/paste/${Date.now()}.png`;
    const how = plan(platform, remote, appOf(f?.terminal));
    if (how === "native") {
      // Herdr already copies an image to another machine and pastes its path; Linux programs read
      // the clipboard on Ctrl+V themselves.
      run(platform === "macos" ? "terminal.paste" : "terminal.paste_image");
      return done();
    }
    if (how === "windows") run("terminal.paste_image");   // text goes in at once
    cx.spawn(async () => {
      try {
        if (how === "windows") {
          const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-STA", "-Command", `& { ${WINDOWS} } '${file.replaceAll("/", "\\").replaceAll("'", "''")}'`], { timeout: 15000 });
          const kind = r.stdout.trim();
          if (kind === "image" || kind === "files") run("terminal.paste");
        } else {
          await exec("osascript", ["-l", "JavaScript", "-e", MACOS, file], { timeout: 15000 }).catch(() => null);
          run("terminal.paste");
        }
      } catch { /* the clipboard could not be read: nothing more to paste */ }
      done();
    });
  }
  render() { return div(); }
}
