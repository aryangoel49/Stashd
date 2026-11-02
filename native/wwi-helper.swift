// Stashd helper: a tiny command-line tool the app runs for two Mac-only jobs.
//
//   wwi-helper windows   Prints which app is in front and the order of app windows, front to back.
//                        Uses only app names and window order (no window titles, no screen pictures).
//   wwi-helper brief     Reads {"instructions": "...", "prompt": "..."} on stdin and asks Apple's
//                        on-device model (Apple Intelligence) for a brief. Runs entirely on this Mac.
//   wwi-helper status    Prints whether Apple Intelligence is available.
//   wwi-helper icons     Reads a JSON list of file or app paths on stdin and prints their Finder
//                        icons as small PNG data URLs (for the tidy-up animation).
//   wwi-helper hide      Reads a JSON list of app names on stdin and hides those apps (like ⌘H), for
//                        Pack up. Nothing is quit, so no work is lost; reopening the app shows it again.
//   wwi-helper chats     Reads a JSON list of chat app names (Claude, ChatGPT) on stdin and prints the chat
//                        open in each one's front window: its title and, for web-based apps, its address.
//                        Uses the Accessibility permission; with "chats ask" macOS asks for it if needed.
//
// Output is always one line of JSON on stdout.

import AppKit
import CoreGraphics
import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

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

func statusCommand() {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
            printJSON(["apple": "available"])
        case .unavailable(let reason):
            printJSON(["apple": "unavailable", "reason": String(describing: reason)])
        }
        return
    }
    #endif
    printJSON(["apple": "unavailable", "reason": "needs macOS 26 or later"])
}

func briefCommand() {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let obj = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
          let instructions = obj["instructions"] as? String,
          let prompt = obj["prompt"] as? String else {
        printJSON(["error": "bad input"])
        return
    }
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        guard case .available = SystemLanguageModel.default.availability else {
            printJSON(["error": "unavailable"])
            return
        }
        let done = DispatchSemaphore(value: 0)
        Task {
            do {
                let session = LanguageModelSession(instructions: instructions)
                let response = try await session.respond(to: prompt)
                printJSON(["text": response.content])
            } catch {
                printJSON(["error": String(describing: error)])
            }
            done.signal()
        }
        done.wait()
        return
    }
    #endif
    printJSON(["error": "unavailable"])
}

func iconsCommand() {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let paths = try? JSONSerialization.jsonObject(with: input) as? [String] else {
        printJSON(["error": "bad input"])
        return
    }
    var out: [Any] = []
    for path in paths.prefix(24) {
        guard FileManager.default.fileExists(atPath: path) else { out.append(NSNull()); continue }
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

// Reads the front window through Accessibility. Web-based apps (Claude) expose their page, whose
// address names the exact chat; native ones (ChatGPT) give at least the window title.
func axValue(_ e: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}

func findPage(_ e: AXUIElement, depth: Int, budget: inout Int) -> (url: String, title: String)? {
    budget -= 1
    if depth > 25 || budget < 0 { return nil }
    if axValue(e, "AXRole") as? String == "AXWebArea", let url = (axValue(e, "AXURL") as? URL)?.absoluteString, url.hasPrefix("https://") {
        return (url, axValue(e, "AXTitle") as? String ?? "")
    }
    for child in (axValue(e, "AXChildren") as? [AXUIElement]) ?? [] {
        if let found = findPage(child, depth: depth + 1, budget: &budget) { return found }
    }
    return nil
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
        var page = findPage(win, depth: 0, budget: &budget)
        if page == nil {
            // The tree can take a moment to appear the first time.
            Thread.sleep(forTimeInterval: 0.3)
            budget = 4000
            page = findPage(win, depth: 0, budget: &budget)
        }
        let windowTitle = axValue(win, "AXTitle") as? String ?? ""
        var chat = ["app": name, "title": page?.title.isEmpty == false ? page!.title : windowTitle]
        if let url = page?.url { chat["url"] = url }
        chats.append(chat)
    }
    printJSON(["trusted": true, "chats": chats])
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "windows": windowsCommand()
case "brief": briefCommand()
case "status": statusCommand()
case "icons": iconsCommand()
case "hide": hideCommand()
case "chats": chatsCommand(ask: args.count > 2 && args[2] == "ask")
default:
    printJSON(["error": "usage: wwi-helper windows|brief|status|icons|hide|chats"])
    exit(2)
}
