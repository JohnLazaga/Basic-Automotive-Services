# Generates src/logo.js with: LOGO_URI (symbol on black rounded box, for light/print),
# LOGO_URI_PRINT (same box, symbol forced WHITE — the red mark goes near-black on a
# mono printer, so the QR sticker would print as a solid black square),
# LOGO_LOCKUP (full primary lockup auto-trimmed, for the dark sidebar/portal), LOGO_BG.
Add-Type -AssemblyName System.Drawing
$root = "C:\Users\John.JASREGALADO\.claude\BASIC_by_JMSI"
$symPath = Join-Path $root "logo_official.png"     # BASIC COLORED SYMBOL (red mark, transparent)
$lockPath = Join-Path $root "logo_primary.png"     # PRIMARY LOGO full lockup (on dark bg)

function To-DataUri([System.Drawing.Bitmap]$bmp){
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $b64 = [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose()
  return "data:image/png;base64," + $b64
}

# ---------- 1) MARK: red symbol on black rounded box (256) ----------
$src = [System.Drawing.Image]::FromFile($symPath)
$size = 256
$mark = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($mark)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$r = 52; $d = $r*2
$p = New-Object System.Drawing.Drawing2D.GraphicsPath
$p.AddArc(0,0,$d,$d,180,90); $p.AddArc($size-$d,0,$d,$d,270,90)
$p.AddArc($size-$d,$size-$d,$d,$d,0,90); $p.AddArc(0,$size-$d,$d,$d,90,90); $p.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,17,17,19))), $p)
$pad = 16
$g.DrawImage($src, $pad, $pad, ($size-2*$pad), ($size-2*$pad))
$g.Dispose()
$markUri = To-DataUri $mark
$mark.Dispose()

# ---------- 1b) PRINT MARK: same box, symbol forced white ----------
# Zeroing the RGB rows and translating by 1,1,1 maps every pixel to white while the
# alpha row stays identity, so the symbol's anti-aliased edges still feather into black.
$cm = New-Object System.Drawing.Imaging.ColorMatrix
$cm.Matrix00 = 0; $cm.Matrix11 = 0; $cm.Matrix22 = 0
$cm.Matrix40 = 1; $cm.Matrix41 = 1; $cm.Matrix42 = 1
$ia = New-Object System.Drawing.Imaging.ImageAttributes
$ia.SetColorMatrix($cm)

$markP = New-Object System.Drawing.Bitmap $size, $size
$gp = [System.Drawing.Graphics]::FromImage($markP)
$gp.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gp.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gp.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gp.Clear([System.Drawing.Color]::Transparent)
$gp.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,17,17,19))), $p)
$dstP = New-Object System.Drawing.Rectangle $pad, $pad, ($size-2*$pad), ($size-2*$pad)
$srcP = New-Object System.Drawing.Rectangle 0, 0, $src.Width, $src.Height
$gp.DrawImage($src, $dstP, $srcP.X, $srcP.Y, $srcP.Width, $srcP.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
$gp.Dispose()
$markPrintUri = To-DataUri $markP
$ia.Dispose(); $markP.Dispose(); $src.Dispose()

# ---------- 2) LOCKUP: auto-trim the primary logo to its artwork ----------
$full = New-Object System.Drawing.Bitmap $lockPath
$ow = $full.Width; $oh = $full.Height

# detect bbox on a downscaled copy for speed
$dw = 360; $dh = [int][Math]::Round($dw * $oh / $ow)
$small = New-Object System.Drawing.Bitmap $dw, $dh
$sg = [System.Drawing.Graphics]::FromImage($small)
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$sg.DrawImage($full, 0, 0, $dw, $dh); $sg.Dispose()

$rect = New-Object System.Drawing.Rectangle 0,0,$dw,$dh
$bd = $small.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $bd.Stride
$buf = New-Object byte[] ($stride * $dh)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $buf, 0, $buf.Length)
$small.UnlockBits($bd)
# bg = top-left
$bgB = $buf[0]; $bgG = $buf[1]; $bgR = $buf[2]
$minX = $dw; $minY = $dh; $maxX = 0; $maxY = 0
for ($y=0; $y -lt $dh; $y++){
  $row = $y * $stride
  for ($x=0; $x -lt $dw; $x++){
    $o = $row + $x*4
    $diff = [Math]::Abs($buf[$o]-$bgB) + [Math]::Abs($buf[$o+1]-$bgG) + [Math]::Abs($buf[$o+2]-$bgR)
    if ($diff -gt 80){
      if ($x -lt $minX){$minX=$x}; if ($x -gt $maxX){$maxX=$x}
      if ($y -lt $minY){$minY=$y}; if ($y -gt $maxY){$maxY=$y}
    }
  }
}
$small.Dispose()
# map bbox to full-res + padding
$scale = $ow / $dw
$padFrac = 0.06
$bw = ($maxX-$minX); $bh = ($maxY-$minY)
$padX = $bw * $padFrac; $padY = $bh * $padFrac
$cx = [int][Math]::Max(0, ($minX-$padX) * $scale)
$cy = [int][Math]::Max(0, ($minY-$padY) * $scale)
$cw = [int][Math]::Min($ow-$cx, ($bw+2*$padX) * $scale)
$ch = [int][Math]::Min($oh-$cy, ($bh+2*$padY) * $scale)
$bgHex = "#{0:x2}{1:x2}{2:x2}" -f $bgR, $bgG, $bgB

# output at target width 600, on bg color (seamless with dark sidebar)
$tw = 600; $th = [int][Math]::Round($tw * $ch / $cw)
$lock = New-Object System.Drawing.Bitmap $tw, $th
$lg = [System.Drawing.Graphics]::FromImage($lock)
$lg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$lg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$lg.Clear([System.Drawing.Color]::FromArgb(255,$bgR,$bgG,$bgB))
$srcRect = New-Object System.Drawing.Rectangle $cx, $cy, $cw, $ch
$dstRect = New-Object System.Drawing.Rectangle 0, 0, $tw, $th
$lg.DrawImage($full, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$lg.Dispose()
$lockUri = To-DataUri $lock
$full.Dispose(); $lock.Dispose()

# ---------- write src/logo.js ----------
$out = "var LOGO_URI = `"$markUri`";`nvar LOGO_URI_PRINT = `"$markPrintUri`";`nvar LOGO_LOCKUP = `"$lockUri`";`nvar LOGO_BG = `"$bgHex`";`n"
Set-Content -Path (Join-Path $root "src\logo.js") -Value $out -Encoding ascii -NoNewline
"mark b64: $($markUri.Length)  print b64: $($markPrintUri.Length)  lockup b64: $($lockUri.Length)  bg: $bgHex  crop: ${cw}x${ch} -> ${tw}x${th}"
