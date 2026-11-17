// make-icons.swift — gera os ícones do Quill (claro e escuro) na grade do macOS (Big Sur+).
//
// Uso (a partir de qualquer pasta):
//   swift ~/Projetos/quill/assets/icon/make-icons.swift
// ou, mais rápido:
//   swiftc -O ~/Projetos/quill/assets/icon/make-icons.swift -o /tmp/make-icons && /tmp/make-icons
//
// Entradas (só leitura, nunca sobrescritas):
//   logo/originais/quill-claro.png   (1254×1254, fundo pêssego sólido de borda a borda)
//   logo/originais/quill-escuro.png  (1254×1254, fundo preto de borda a borda; versão escura gerada à parte)
// Saídas:   assets/icon/{light,dark}/Quill-1024.png, AppIcon.iconset/ (10 tamanhos), Quill.icns
//
// Para cada original: imagem inteira redimensionada para 824×824, centralizada num canvas
// 1024×1024 transparente, máscara de retângulo de cantos contínuos (raio 185) e sombra sutil
// (opacidade 0,28, desfoque 20, 6 px para baixo). Depois iconset (10 tamanhos) e .icns (iconutil).

import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let scriptDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let root = scriptDir.deletingLastPathComponent().deletingLastPathComponent() // ~/Projetos/quill
let originals = root.appendingPathComponent("logo/originais")
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

// MARK: - imagens

func loadImage(_ url: URL) -> CGImage {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fatalError("não abriu \(url.path)") }
    return img
}

func savePNG(_ img: CGImage, _ url: URL) {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let dst = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dst, img, nil)
    guard CGImageDestinationFinalize(dst) else { fatalError("falhou ao gravar \(url.path)") }
}

// MARK: - caminho de cantos contínuos (estilo Apple)

/// Retângulo com cantos contínuos, mesma aproximação do UIBezierPath(roundedRect:cornerRadius:)
/// do iOS 7+: cada canto se estende 1,52866·r pela aresta.
func continuousRoundedRect(_ rect: CGRect, radius r: CGFloat) -> CGPath {
    let seg: [(CGPoint, CGPoint, CGPoint)?] = [ // (cp1, cp2, fim); nil = linha
        nil,
        (CGPoint(x: 1.08849323, y: 0), CGPoint(x: 0.86840689, y: 0), CGPoint(x: 0.66993427, y: 0.06549600)),
        nil,
        (CGPoint(x: 0.37282392, y: 0.16905899), CGPoint(x: 0.16906013, y: 0.37282401), CGPoint(x: 0.07491176, y: 0.63149399)),
        (CGPoint(x: 0, y: 0.86840701), CGPoint(x: 0, y: 1.08849299), CGPoint(x: 0, y: 1.52866483)),
    ]
    let lineEnds: [CGPoint] = [CGPoint(x: 1.52866471, y: 0), CGPoint(x: 0.63149399, y: 0.07491100)]
    let corners: [(CGPoint, CGFloat, CGFloat, Bool)] = [
        (CGPoint(x: rect.maxX, y: rect.maxY), -1, -1, false),
        (CGPoint(x: rect.maxX, y: rect.minY), -1, +1, true),
        (CGPoint(x: rect.minX, y: rect.minY), +1, +1, false),
        (CGPoint(x: rect.minX, y: rect.maxY), +1, -1, true),
    ]
    let p = CGMutablePath()
    for (k, (c, sx, sy, swap)) in corners.enumerated() {
        func map(_ q: CGPoint) -> CGPoint {
            let (dx, dy) = swap ? (q.y, q.x) : (q.x, q.y)
            return CGPoint(x: c.x + sx * dx * r, y: c.y + sy * dy * r)
        }
        var li = 0
        for s in seg {
            if let (c1, c2, e) = s {
                p.addCurve(to: map(e), control1: map(c1), control2: map(c2))
            } else {
                let e = map(lineEnds[li]); li += 1
                if k == 0 && li == 1 { p.move(to: e) } else { p.addLine(to: e) }
            }
        }
    }
    p.closeSubpath()
    return p
}

// MARK: - master 1024

let canvas = 1024, art: CGFloat = 824, radius: CGFloat = 185

func makeMaster(from src: CGImage, shadow: Bool) -> CGImage {
    let ctx = CGContext(data: nil, width: canvas, height: canvas, bitsPerComponent: 8, bytesPerRow: 0,
                        space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.clear(CGRect(x: 0, y: 0, width: canvas, height: canvas))
    ctx.interpolationQuality = .high
    let margin = (CGFloat(canvas) - art) / 2
    let rect = CGRect(x: margin, y: margin, width: art, height: art)
    let path = continuousRoundedRect(rect, radius: radius)
    if shadow { // sombra sutil, deslocada para baixo, contida na margem de 100 px
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 20, color: CGColor(gray: 0, alpha: 0.28))
        ctx.addPath(path); ctx.setFillColor(CGColor(gray: 0, alpha: 1)); ctx.fillPath()
        ctx.restoreGState()
    }
    ctx.saveGState()
    ctx.addPath(path); ctx.clip()
    ctx.draw(src, in: rect)
    ctx.restoreGState()
    return ctx.makeImage()!
}

func resized(_ img: CGImage, _ size: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: size, height: size))
    return ctx.makeImage()!
}

// MARK: - execução

let iconsetSizes: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

for (name, file) in [("light", "quill-claro.png"), ("dark", "quill-escuro.png")] {
    let src = loadImage(originals.appendingPathComponent(file))
    print("\(file): \(src.width)×\(src.height)")
    let dir = scriptDir.appendingPathComponent(name)
    let master = makeMaster(from: src, shadow: true)
    savePNG(master, dir.appendingPathComponent("Quill-1024.png"))
    let iconset = dir.appendingPathComponent("AppIcon.iconset")
    try? FileManager.default.removeItem(at: iconset)
    for (file, size) in iconsetSizes {
        savePNG(size == 1024 ? master : resized(master, size), iconset.appendingPathComponent("\(file).png"))
    }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
    p.arguments = ["-c", "icns", iconset.path, "-o", dir.appendingPathComponent("Quill.icns").path]
    try! p.run(); p.waitUntilExit()
    guard p.terminationStatus == 0 else { fatalError("iconutil falhou para \(name)") }
    print("ok: \(name)/Quill-1024.png, \(name)/AppIcon.iconset, \(name)/Quill.icns")
}
