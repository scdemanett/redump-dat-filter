Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path $PSScriptRoot '..\build'

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$sizes = @(16, 24, 32, 48, 64, 128, 256, 512, 1024)

function New-IconBitmap {
    param (
        [int] $Size
    )

    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::FromArgb(13, 17, 23))

    $padding = [Math]::Max([Math]::Round($Size * 0.0625), 2)
    $ellipseRect = New-Object System.Drawing.RectangleF $padding, $padding, ($Size - 2 * $padding), ($Size - 2 * $padding)
    $gradientRect = New-Object System.Drawing.RectangleF 0, 0, $Size, $Size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $gradientRect, ([System.Drawing.Color]::FromArgb(37, 99, 235)), ([System.Drawing.Color]::FromArgb(45, 212, 191)), 45
    $graphics.FillEllipse($brush, $ellipseRect)

    $fontSize = [Math]::Max($Size * 0.43, 10)
    $font = New-Object System.Drawing.Font ('Segoe UI Semibold', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center

    $graphics.DrawString('R', $font, [System.Drawing.Brushes]::White, $gradientRect, $format)

    $brush.Dispose()
    $font.Dispose()
    $format.Dispose()
    $graphics.Dispose()

    return $bitmap
}

$iconPngPath = Join-Path $outputDir 'icon.png'
$primaryBitmap = New-IconBitmap -Size 512
$primaryBitmap.Save($iconPngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$primaryBitmap.Dispose()

foreach ($size in $sizes) {
    $bmp = New-IconBitmap -Size $size
    $path = Join-Path $outputDir "icon_${size}.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# Generate ICO with multiple sizes
$icoPath = Join-Path $outputDir 'icon.ico'

$iconSizesForIco = @(16, 24, 32, 48, 64, 128, 256)
$iconStreams = @()

try {
    $memoryStream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter $memoryStream

    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$iconSizesForIco.Count)

    $entries = @()
    $offset = 6 + (16 * $iconSizesForIco.Count)

    foreach ($size in $iconSizesForIco) {
        $pngBytes = [System.IO.File]::ReadAllBytes((Join-Path $outputDir "icon_${size}.png"))

        $widthByte = if ($size -eq 256) { [byte]0 } else { [byte][Math]::Min($size, 255) }
        $entry = [PSCustomObject]@{
            Width = $widthByte
            Height = $widthByte
            ColorCount = [byte]0
            Reserved = [byte]0
            Planes = [UInt16]0
            BitCount = [UInt16]32
            BytesInRes = [UInt32]$pngBytes.Length
            ImageOffset = [UInt32]$offset
            Data = $pngBytes
        }

        $entries += $entry
        $offset += $pngBytes.Length
    }

    foreach ($entry in $entries) {
        $writer.Write($entry.Width)
        $writer.Write($entry.Height)
        $writer.Write($entry.ColorCount)
        $writer.Write($entry.Reserved)
        $writer.Write($entry.Planes)
        $writer.Write($entry.BitCount)
        $writer.Write($entry.BytesInRes)
        $writer.Write($entry.ImageOffset)
    }

    foreach ($entry in $entries) {
        $writer.Write($entry.Data)
    }

    $writer.Flush()
    [System.IO.File]::WriteAllBytes($icoPath, $memoryStream.ToArray())
}
finally {
    foreach ($stream in $iconStreams) {
        $stream.Dispose()
    }
    if ($writer) { $writer.Dispose() }
    if ($memoryStream) { $memoryStream.Dispose() }
}

