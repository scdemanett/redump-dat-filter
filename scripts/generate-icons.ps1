Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path $PSScriptRoot '..\build'
$sourcePngPath = Join-Path $outputDir 'icon.png'

if (-not (Test-Path $sourcePngPath)) {
    Write-Error "Missing source icon: $sourcePngPath"
    exit 1
}

$sizes = @(16, 24, 32, 48, 64, 128, 256, 512, 1024)
$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $sourcePngPath))

try {
    function New-ResizedPng {
        param (
            [System.Drawing.Image] $Source,
            [int] $Size,
            [string] $Path
        )

        $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.DrawImage($Source, 0, 0, $Size, $Size)
        $graphics.Dispose()

        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
    }

    foreach ($size in $sizes) {
        $path = Join-Path $outputDir "icon_${size}.png"
        New-ResizedPng -Source $sourceImage -Size $size -Path $path
        Write-Host "Wrote $path"
    }

    # Multiresolution ICO (embedded PNGs)
    $icoPath = Join-Path $outputDir 'icon.ico'
    $iconSizesForIco = @(16, 24, 32, 48, 64, 128, 256)

    $memoryStream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter $memoryStream

    try {
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]$iconSizesForIco.Count)

        $entries = @()
        $offset = 6 + (16 * $iconSizesForIco.Count)

        foreach ($size in $iconSizesForIco) {
            $pngBytes = [System.IO.File]::ReadAllBytes((Join-Path $outputDir "icon_${size}.png"))
            $widthByte = if ($size -eq 256) { [byte]0 } else { [byte]$size }
            $entries += [PSCustomObject]@{
                Width = $widthByte
                Height = $widthByte
                ColorCount = [byte]0
                Reserved = [byte]0
                Planes = [UInt16]1
                BitCount = [UInt16]32
                BytesInRes = [UInt32]$pngBytes.Length
                ImageOffset = [UInt32]$offset
                Data = $pngBytes
            }
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
        Write-Host "Wrote $icoPath"
    }
    finally {
        $writer.Dispose()
        $memoryStream.Dispose()
    }
}
finally {
    $sourceImage.Dispose()
}

Write-Host 'Icon set generated from build/icon.png'
