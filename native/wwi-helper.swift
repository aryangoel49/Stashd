// Where Was I helper: a tiny command-line tool the app runs for two Mac-only jobs.
//
//   wwi-helper windows   Prints which app is in front and the order of app windows, front to back.
//                        Uses only app names and window order (no window titles, no screen pictures).
//   wwi-helper brief     Reads {"instructions": "...", "prompt": "..."} on stdin and asks Apple's
//                        on-device model (Apple Intelligence) for a brief. Runs entirely on this Mac.
//   wwi-helper status    Prints whether Apple Intelligence is available.
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

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "windows": windowsCommand()
case "brief": briefCommand()
case "status": statusCommand()
default:
    printJSON(["error": "usage: wwi-helper windows|brief|status"])
    exit(2)
}
