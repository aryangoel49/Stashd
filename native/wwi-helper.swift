// Stashd helper: a tiny command-line tool the app runs for Mac-only jobs.
//
//   wwi-helper windows   Prints which app is in front and the order of app windows, front to back.
//                        Uses only app names and window order (no window titles, no screen pictures).
//   wwi-helper icons     Reads a JSON list of file or app paths (or app names) on stdin and prints their
//                        Finder icons as small PNG data URLs (for item badges and the tidy-up animation).
//   wwi-helper hide      Reads a JSON list of app names on stdin and hides those apps (like ⌘H), for
//                        Pack up. Nothing is quit, so no work is lost; reopening the app shows it again.
//   wwi-helper quit      Reads a JSON list of app names on stdin and asks those apps to quit (like ⌘Q), for
//                        Pack up. Never forced: an app with unsaved work asks to save first, as usual.
//   wwi-helper chats     Reads a JSON list of chat app names (Claude, ChatGPT) on stdin and prints the chat
//                        open in each one's front window: its title and, for web-based apps, its address
//                        and the last ~2000 characters of the conversation on screen (for the brief).
//                        Uses the Accessibility permission; with "chats ask" macOS asks for it if needed.
//   (Chrome)             Started by Chrome for Stashd's extension (native messaging: Chrome passes the
//                        extension's address as the first argument). Reads one message, how far into each
//                        video you got and which tab group each tab is in, and keeps it in Stashd's folder
//                        (chrome.json) for Stashd to read. Nothing else is read or written.
//
// Output is always one line of JSON on stdout (Chrome's messages are length-prefixed, as Chrome requires).

import AppKit
import CoreGraphics
import Foundation

func printJSON(_ value: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: []),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\"error\":\"could not encode output\"}")
    }
}

func windowsCommand() {
    let workspace = NSWorkspace.shared
    let front = workspace.frontmostApplication
    let apps = workspace.runningApplications
        .filter { $0.activationPolicy == .regular }
        .map { app -> [String: Any] in
            [
                "name": app.localizedName ?? "",
                "bundleId": app.bundleIdentifier ?? "",
                "path": app.bundleURL?.path ?? "",
                "hidden": app.isHidden,
            ]
        }

    // Window list, front to back. Owner names are available without Screen Recording permission.
    var order: [String] = []
    let options: CGWindowListOption = [.excludeDesktopElements]
    if let info = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] {
        for window in info {
            guard (window[kCGWindowLayer as String] as? Int) == 0,
                  let owner = window[kCGWindowOwnerName as String] as? String,
                  !owner.isEmpty else { continue }
            if !order.contains(owner) { order.append(owner) }
        }
    }

    printJSON([
        "front": front?.localizedName ?? NSNull(),
        "frontBundleId": front?.bundleIdentifier ?? NSNull(),
        "apps": apps,
        "order": order,
    ])
}

func iconsCommand() {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let paths = try? JSONSerialization.jsonObject(with: input) as? [String] else {
        printJSON(["error": "bad input"])
        return
    }
    var out: [Any] = []
    for source in paths.prefix(60) {
        // A file or app path, or just an app's name ("Microsoft Word"), which is looked up.
        let path = source.hasPrefix("/") ? source : (NSWorkspace.shared.fullPath(forApplication: source) ?? "")
        guard !path.isEmpty, FileManager.default.fileExists(atPath: path) else { out.append(NSNull()); continue }
        let icon = NSWorkspace.shared.icon(forFile: path)
        let size = NSSize(width: 128, height: 128)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 128, pixelsHigh: 128, bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
            out.append(NSNull()); continue
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        icon.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        if let png = rep.representation(using: .png, properties: [:]) {
            out.append("data:image/png;base64," + png.base64EncodedString())
        } else {
            out.append(NSNull())
        }
    }
    printJSON(["icons": out])
}

func hideCommand() {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let names = try? JSONSerialization.jsonObject(with: input) as? [String] else {
        printJSON(["error": "bad input"])
        return
    }
    let wanted = Set(names.map { $0.lowercased() })
    var hidden: [String] = []
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        guard let name = app.localizedName, wanted.contains(name.lowercased()) else { continue }
        if app.isHidden || app.hide() { hidden.append(name) }
    }
    printJSON(["hidden": hidden])
}

func quitCommand() {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let names = try? JSONSerialization.jsonObject(with: input) as? [String] else {
        printJSON(["error": "bad input"])
        return
    }
    let wanted = Set(names.map { $0.lowercased() })
    var quit: [String] = []
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        guard let name = app.localizedName, wanted.contains(name.lowercased()) else { continue }
        if app.terminate() { quit.append(name) }
    }
    printJSON(["quit": quit])
}

// Reads the front window through Accessibility. Web-based apps (Claude) expose their page, whose
// address names the exact chat; native ones (ChatGPT) give at least the window title.
func axValue(_ e: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}

func findPage(_ e: AXUIElement, depth: Int, budget: inout Int) -> (url: String, title: String, element: AXUIElement)? {
    budget -= 1
    if depth > 25 || budget < 0 { return nil }
    if axValue(e, "AXRole") as? String == "AXWebArea", let url = (axValue(e, "AXURL") as? URL)?.absoluteString, url.hasPrefix("https://") {
        return (url, axValue(e, "AXTitle") as? String ?? "", e)
    }
    for child in (axValue(e, "AXChildren") as? [AXUIElement]) ?? [] {
        if let found = findPage(child, depth: depth + 1, budget: &budget) { return found }
    }
    return nil
}

/** The text of the conversation on screen: the page's main area (not the sidebar), last part only. */
func conversationText(_ page: AXUIElement) -> String {
    var budget = 6000
    func mainArea(_ e: AXUIElement, _ depth: Int) -> AXUIElement? {
        budget -= 1
        if depth > 20 || budget < 0 { return nil }
        if axValue(e, "AXSubrole") as? String == "AXLandmarkMain" { return e }
        for child in (axValue(e, "AXChildren") as? [AXUIElement]) ?? [] {
            if let found = mainArea(child, depth + 1) { return found }
        }
        return nil
    }
    let area = mainArea(page, 0) ?? page
    var parts: [String] = []
    var messages: [AXUIElement] = []
    var reachedInput = false
    budget = 20000
    // Messages come before the box you type in; what follows it is controls (model picker, usage).
    func collect(_ e: AXUIElement, _ depth: Int) {
        budget -= 1
        if depth > 60 || budget < 0 || reachedInput { return }
        let role = axValue(e, "AXRole") as? String
        if role == "AXTextArea" || (role == "AXTextField" && axValue(e, "AXEditableAncestor") != nil) {
            if messages.isEmpty { reachedInput = true }
            return
        }
        // Code and command output say little about what the work is.
        if axValue(e, "AXSubrole") as? String == "AXCodeStyleGroup" { return }
        if role == "AXStaticText", let s = axValue(e, "AXValue") as? String, !s.isEmpty { parts.append(s) }
        for child in (axValue(e, "AXChildren") as? [AXUIElement]) ?? [] { collect(child, depth + 1) }
    }
    // Claude marks each message (a "message" class, or an id with "msg_"); when it does, read only those.
    budget = 20000
    func findMessages(_ e: AXUIElement, _ depth: Int) {
        budget -= 1
        if depth > 40 || budget < 0 { return }
        let id = axValue(e, "AXDOMIdentifier") as? String ?? ""
        let classes = (axValue(e, "AXDOMClassList") as? [String]) ?? []
        if id.contains("msg_") || classes.contains(where: { $0.contains("message") }) { messages.append(e); return }
        for child in (axValue(e, "AXChildren") as? [AXUIElement]) ?? [] { findMessages(child, depth + 1) }
    }
    findMessages(area, 0)
    budget = 20000
    if messages.isEmpty {
        collect(area, 0)
    } else {
        // Inside a message, a text box is part of it (a code block), not the place you type.
        for m in messages.suffix(12) {
            reachedInput = false
            collect(m, 0)
        }
    }
    let text = parts.joined(separator: " ").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    return String(text.suffix(3000))
}

func chatsCommand(ask: Bool) {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let names = Set(((try? JSONSerialization.jsonObject(with: input)) as? [String] ?? []).map { $0.lowercased() })
    let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: ask] as CFDictionary)
    guard trusted else {
        printJSON(["trusted": false, "chats": []])
        return
    }
    var chats: [[String: String]] = []
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        guard let name = app.localizedName, names.contains(name.lowercased()) else { continue }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 1.0)
        // Chromium-based apps only build their accessibility tree once asked to.
        AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        guard let window = (axValue(root, "AXMainWindow") ?? (axValue(root, "AXWindows") as? [AnyObject])?.first) else { continue }
        let win = window as! AXUIElement
        var budget = 4000
        var page: (url: String, title: String, element: AXUIElement)? = findPage(win, depth: 0, budget: &budget)
        if page == nil {
            // The tree can take a moment to appear the first time.
            Thread.sleep(forTimeInterval: 0.3)
            budget = 4000
            page = findPage(win, depth: 0, budget: &budget)
        }
        let windowTitle = axValue(win, "AXTitle") as? String ?? ""
        var chat = ["app": name, "title": page?.title.isEmpty == false ? page!.title : windowTitle]
        if let url = page?.url { chat["url"] = url }
        if let element = page?.element {
            let text = conversationText(element)
            if !text.isEmpty { chat["text"] = text }
        }
        chats.append(chat)
    }
    printJSON(["trusted": true, "chats": chats])
}

/** Chrome's native messaging: a 4-byte length (this Mac's byte order), then that much JSON, each way. */
func chromeHostCommand() {
    let input = FileHandle.standardInput
    let head = input.readData(ofLength: 4)
    guard head.count == 4 else { exit(0) }
    let length = head.withUnsafeBytes { Int($0.loadUnaligned(as: UInt32.self)) }
    guard length > 0, length <= 4_000_000 else { exit(1) }
    let body = input.readData(ofLength: length)
    var ok = false
    if body.count == length, (try? JSONSerialization.jsonObject(with: body)) is [String: Any],
       let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
        let dir = base.appendingPathComponent("Stashd", isDirectory: true)
        let file = dir.appendingPathComponent("chrome.json")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try body.write(to: file, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            ok = true
        } catch {}
    }
    let reply = (try? JSONSerialization.data(withJSONObject: ["ok": ok])) ?? Data("{}".utf8)
    var size = UInt32(reply.count)
    let out = FileHandle.standardOutput
    out.write(Data(bytes: &size, count: 4))
    out.write(reply)
}

/// Which apps Stashd may control (macOS's Automation permission), without asking: one of
/// "allowed", "denied", "ask" (macOS hasn't asked yet), "notRunning" (macOS can only check a running app),
/// "notInstalled". With "ask", macOS shows its "Stashd wants to control …" prompt for each running app that
/// hasn't been asked, one after another. Input: a JSON list of bundle ids. Checked with the kind of message
/// Stashd's scripts send (Core suite, get data), so the answer is the one that counts.
func automationCommand(ask: Bool) {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let ids = ((try? JSONSerialization.jsonObject(with: input)) as? [String]) ?? []
    var out: [String: String] = [:]
    for id in ids.prefix(40) {
        if NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) == nil {
            out[id] = "notInstalled"
            continue
        }
        var target = AEAddressDesc()
        let made = id.withCString { AECreateDesc(DescType(typeApplicationBundleID), $0, strlen($0), &target) }
        guard made == noErr else {
            out[id] = "error"
            continue
        }
        let r = AEDeterminePermissionToAutomateTarget(&target, AEEventClass(kAECoreSuite), AEEventID(kAEGetData), ask)
        AEDisposeDesc(&target)
        switch r {
        case noErr: out[id] = "allowed"
        case OSStatus(errAEEventNotPermitted): out[id] = "denied"
        case OSStatus(errAEEventWouldRequireUserConsent): out[id] = "ask"
        case OSStatus(procNotFound): out[id] = "notRunning"
        default: out[id] = "error"
        }
    }
    printJSON(out)
}

/// Whether Stashd may use Accessibility (to see which Claude or ChatGPT chat is open). With "ask", macOS
/// shows its prompt that leads to System Settings.
func accessibilityCommand(ask: Bool) {
    let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: ask] as CFDictionary)
    printJSON(["trusted": trusted])
}

// ---------- Trackpad gesture: four-finger double tap → Tidy all ----------
// Reads the trackpad's touches through macOS's MultitouchSupport framework (loaded at run time; it has no
// public header, the same way BetterTouchTool does it). Only the number of fingers, when they land and lift,
// and how far they move are looked at. Prints {"gesture":"tidy"} on its own line for each four-finger double
// tap, and keeps running until Stashd stops it. If the framework isn't there, prints {"error":…} and exits.

typealias MTDeviceRef = UnsafeMutableRawPointer
typealias MTContactCallback = @convention(c) (Int32, UnsafeMutableRawPointer?, Int32, Double, Int32) -> Int32

/// One finger in a contact frame (96 bytes; the touch position, 0…1 on each side, is 32 bytes in).
let FINGER_STRIDE = 96
let FINGER_POS = 32

final class TapWatcher {
    static let shared = TapWatcher()
    private var downAt = 0.0
    private var peak = 0
    private var start: (Float, Float)? = nil
    private var moved: Float = 0
    private var lastTap = 0.0
    private var lastFired = 0.0

    /// A tap: exactly four fingers at most, down and up again within 0.3 s, barely moving.
    /// Two taps within 0.45 s are the gesture.
    func frame(_ fingers: UnsafeMutableRawPointer?, _ count: Int, _ time: Double) {
        if count > 0 {
            if peak == 0 { downAt = time; moved = 0; start = nil }
            peak = max(peak, count)
            if count == 4, let f = fingers {
                var cx: Float = 0, cy: Float = 0
                for i in 0..<4 {
                    let base = f + i * FINGER_STRIDE + FINGER_POS
                    cx += base.load(as: Float.self); cy += (base + 4).load(as: Float.self)
                }
                cx /= 4; cy /= 4
                if cx.isFinite, cy.isFinite, cx >= -0.1, cx <= 1.1, cy >= -0.1, cy <= 1.1 {
                    if let s = start { moved = max(moved, abs(cx - s.0) + abs(cy - s.1)) } else { start = (cx, cy) }
                }
            }
            return
        }
        // All fingers lifted.
        let wasTap = peak == 4 && time - downAt < 0.3 && moved < 0.06
        peak = 0
        guard wasTap else { lastTap = 0; return }
        if lastTap > 0, time - lastTap < 0.45, time - lastFired > 1.0 {
            lastFired = time
            lastTap = 0
            printJSON(["gesture": "tidy"])
            fflush(stdout)
        } else {
            lastTap = time
        }
    }
}

let contactCallback: MTContactCallback = { _, fingers, count, time, _ in
    TapWatcher.shared.frame(fingers, Int(count), time)
    return 0
}

func gesturesCommand() {
    guard let lib = dlopen("/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport", RTLD_NOW),
          let listSym = dlsym(lib, "MTDeviceCreateList"),
          let registerSym = dlsym(lib, "MTRegisterContactFrameCallback"),
          let startSym = dlsym(lib, "MTDeviceStart") else {
        printJSON(["error": "trackpad not available"])
        exit(1)
    }
    typealias ListFn = @convention(c) () -> Unmanaged<CFArray>?
    typealias RegisterFn = @convention(c) (MTDeviceRef, MTContactCallback) -> Void
    typealias StartFn = @convention(c) (MTDeviceRef, Int32) -> Void
    let list = unsafeBitCast(listSym, to: ListFn.self)
    let register = unsafeBitCast(registerSym, to: RegisterFn.self)
    let start = unsafeBitCast(startSym, to: StartFn.self)
    guard let devices = list()?.takeRetainedValue() as? [AnyObject], !devices.isEmpty else {
        printJSON(["error": "no trackpad"])
        exit(1)
    }
    for d in devices {
        let ref = Unmanaged.passUnretained(d).toOpaque()
        register(ref, contactCallback)
        start(ref, 0)
    }
    printJSON(["ready": devices.count])
    fflush(stdout)
    // Stop when Stashd goes away (its end of our input closes).
    DispatchQueue.global().async {
        _ = FileHandle.standardInput.readDataToEndOfFile()
        exit(0)
    }
    CFRunLoopRun()
}

let args = CommandLine.arguments
if args.count > 1, args[1].hasPrefix("chrome-extension://") {
    chromeHostCommand()
    exit(0)
}
switch args.count > 1 ? args[1] : "" {
case "windows": windowsCommand()
case "icons": iconsCommand()
case "hide": hideCommand()
case "quit": quitCommand()
case "chats": chatsCommand(ask: args.count > 2 && args[2] == "ask")
case "automation": automationCommand(ask: args.count > 2 && args[2] == "ask")
case "accessibility": accessibilityCommand(ask: args.count > 2 && args[2] == "ask")
case "gestures": gesturesCommand()
default:
    printJSON(["error": "usage: wwi-helper windows|icons|hide|quit|chats|automation|accessibility|gestures"])
    exit(2)
}
