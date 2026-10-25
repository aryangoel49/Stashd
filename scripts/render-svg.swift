// Renders an SVG to a square PNG with AppKit (macOS 13+ reads SVG natively).
// Usage: swift render-svg.swift <in.svg> <size> <out.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 4, let size = Int(args[2]), let image = NSImage(contentsOfFile: args[1]) else {
  FileHandle.standardError.write("usage: render-svg <in.svg> <size> <out.png>\n".data(using: .utf8)!)
  exit(1)
}
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
// Fit the drawing in the square, keeping its proportions.
let s = image.size
let scale = min(CGFloat(size) / s.width, CGFloat(size) / s.height)
let w = s.width * scale, h = s.height * scale
image.draw(in: NSRect(x: (CGFloat(size) - w) / 2, y: (CGFloat(size) - h) / 2, width: w, height: h))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[3]))
