@echo off
setlocal
set "PROJECT=C:\Users\Ku\Desktop\WebProjects\speaking-exam"
set "ENVFILE=%PROJECT%\.env.local"

 echo.
 echo Speaking Exam Phase 6 - Teacher Admin Setup
 echo.
 echo This will add THREE server-only values to .env.local:
 echo   SUPABASE_SERVICE_ROLE_KEY
 echo   TEACHER_ADMIN_PASSWORD
 echo   TEACHER_ADMIN_SESSION_SECRET
 echo.
 echo IMPORTANT: Do NOT use NEXT_PUBLIC_ for any of these values.
 echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$envFile='%ENVFILE%';" ^
  "$svcSecure=Read-Host 'Paste Supabase service_role / secret key' -AsSecureString;" ^
  "$svcPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($svcSecure);" ^
  "try {$svc=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($svcPtr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($svcPtr)};" ^
  "$pwdSecure=Read-Host 'Choose the Teacher Admin password' -AsSecureString;" ^
  "$pwdPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwdSecure);" ^
  "try {$pwd=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pwdPtr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pwdPtr)};" ^
  "if ([string]::IsNullOrWhiteSpace($svc) -or [string]::IsNullOrWhiteSpace($pwd)) {Write-Host 'Missing value.' -ForegroundColor Red; exit 1};" ^
  "$bytes=New-Object byte[] 48; $rng=[System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose(); $secret=[Convert]::ToBase64String($bytes);" ^
  "if (Test-Path $envFile) {$lines=Get-Content $envFile} else {$lines=@()};" ^
  "$filtered=$lines | Where-Object {$_ -notmatch '^(SUPABASE_SERVICE_ROLE_KEY|TEACHER_ADMIN_PASSWORD|TEACHER_ADMIN_SESSION_SECRET)='};" ^
  "$filtered += ('SUPABASE_SERVICE_ROLE_KEY=' + $svc);" ^
  "$filtered += ('TEACHER_ADMIN_PASSWORD=' + $pwd);" ^
  "$filtered += ('TEACHER_ADMIN_SESSION_SECRET=' + $secret);" ^
  "Set-Content -Path $envFile -Value $filtered -Encoding UTF8;" ^
  "Write-Host 'Phase 6 secrets saved.' -ForegroundColor Green"

 echo.
 echo DONE.
 echo Restart Next.js after this:
 echo   Ctrl+C
 echo   npm run dev -- -p 3002
 echo.
 pause
