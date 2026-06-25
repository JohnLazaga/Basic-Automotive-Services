# Export the active parts catalog (SKU, Part Name, Net Price, SRP) from SQL Server
# to a tab-separated file. Streams rows (fast, low memory) for the 100k+ catalog.
$ErrorActionPreference = 'Stop'
$server = 'localhost\MSSQLSERVER01'
$db     = 'jasRegaladoDB'
$out    = Join-Path $PSScriptRoot 'parts.tsv'

$sql = @"
SELECT ap.fldStockCode AS sku, p.fldPartDesc AS part_name,
       ap.fldNetPrice AS net_price, ap.fldSRP AS srp
FROM tblAutoPart ap
LEFT JOIN tblPart p ON ap.fldPartNameCode = p.fldPartNameCode
WHERE ap.fldIsActive = 1
ORDER BY ap.fldStockCode
"@

$cs = "Server=$server;Database=$db;Integrated Security=SSPI;TrustServerCertificate=True;Encrypt=False;Connect Timeout=15"
$cn = New-Object System.Data.SqlClient.SqlConnection $cs
$cn.Open()
$cmd = $cn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 300
$rd = $cmd.ExecuteReader()
$sw = New-Object System.IO.StreamWriter($out, $false, (New-Object System.Text.UTF8Encoding($false)))
$n = 0
while ($rd.Read()) {
  $sku  = [string]$rd[0]
  $name = ([string]$rd[1]) -replace "[\t\r\n]", ' '
  $net  = $rd[2]; if ($net -is [System.DBNull]) { $net = 0 }
  $srp  = $rd[3]; if ($srp -is [System.DBNull]) { $srp = 0 }
  if ([string]::IsNullOrWhiteSpace($sku)) { continue }
  $sw.WriteLine("$sku`t$name`t$net`t$srp")
  $n++
}
$sw.Close(); $rd.Close(); $cn.Close()
Write-Host "Exported $n parts to $out"
