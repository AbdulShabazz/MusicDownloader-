@echo off
setlocal

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass ^
  "$files = Get-ChildItem -LiteralPath . -File -Filter *.wav; " ^
  "foreach ($f in $files) { " ^
  "  $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name); " ^
  "  $newBase = $base -replace '^\d+\s*-\s*',''; " ^
  "  if ($newBase -ne $base) { " ^
  "    $newName = $newBase + $f.Extension; " ^
  "    if (-not (Test-Path -LiteralPath $newName)) { " ^
  "      Rename-Item -LiteralPath $f.FullName -NewName $newName; " ^
  "      Write-Host ('Renamed: ' + $f.Name + ' -> ' + $newName); " ^
  "    } else { " ^
  "      Write-Host ('Skipped collision: ' + $f.Name + ' -> ' + $newName); " ^
  "    } " ^
  "  } " ^
  "}"

pause