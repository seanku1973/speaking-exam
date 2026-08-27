@echo off
setlocal
set "PROJECT=C:\Users\Ku\Desktop\WebProjects\speaking-exam"
set "ENVFILE=%PROJECT%\.env.local"

echo.
echo OpenAI API Key Setup
echo The key will be stored ONLY in:
echo %ENVFILE%
echo.
echo Your key will NOT use NEXT_PUBLIC_.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$envFile='%ENVFILE%';" ^
  "$secure=Read-Host 'Paste your OpenAI API key' -AsSecureString;" ^
  "$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);" ^
  "try {$key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};" ^
  "if ([string]::IsNullOrWhiteSpace($key)) { Write-Host 'No key entered.' -ForegroundColor Red; exit 1 };" ^
  "if (Test-Path $envFile) {$lines=Get-Content $envFile} else {$lines=@()};" ^
  "$filtered=$lines | Where-Object {$_ -notmatch '^OPENAI_API_KEY='};" ^
  "$filtered += ('OPENAI_API_KEY=' + $key);" ^
  "Set-Content -Path $envFile -Value $filtered -Encoding UTF8;" ^
  "Write-Host 'OPENAI_API_KEY saved.' -ForegroundColor Green"

echo.
echo IMPORTANT:
echo Restart npm run dev so Next.js can read the new key.
echo.
pause
