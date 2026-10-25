import AVFoundation
import AppKit
let args = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let out = args[2]
let dur = CMTimeGetSeconds(asset.duration)
print("duration", dur)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.maximumSize = CGSize(width: 900, height: 900)
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
let n = 18
for i in 0..<n {
  let t = dur * Double(i) / Double(n)
  if let cg = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) {
    let rep = NSBitmapImageRep(cgImage: cg)
    let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6])!
    try! data.write(to: URL(fileURLWithPath: String(format: "%@/f%02d_%03ds.jpg", out, i, Int(t))))
  }
}
