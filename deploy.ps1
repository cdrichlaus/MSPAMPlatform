# AdminWorks Deploy Script
# Reads credentials from deploy-config.json and uploads to GoDaddy

$configFile = "$PSScriptRoot\deploy-config.json"

if (Test-Path $configFile) {
    $config    = Get-Content $configFile | ConvertFrom-Json
    $ftpServer = $config.FtpServer
    $ftpUser   = $config.FtpUsername
    $plainPass = $config.FtpPassword
} else {
    $ftpServer   = Read-Host "FTP Server"
    $ftpUser     = Read-Host "FTP Username"
    $securePass  = Read-Host "FTP Password" -AsSecureString
    $plainPass   = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                     [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass))
}

$localFile = "$PSScriptRoot\adminworks-website.html"
$remoteUrl = "ftp://$ftpServer/public_html/index.html"

Write-Host ""
Write-Host "Deploying to $remoteUrl ..." -ForegroundColor Cyan

curl.exe -s -T $localFile `
         --resolve "${ftpServer}:21:132.148.179.45" `
         --user "${ftpUser}:${plainPass}" `
         --ftp-create-dirs `
         $remoteUrl

if ($LASTEXITCODE -eq 0) {
    Write-Host "SUCCESS - adminworksllc.com is live" -ForegroundColor Green
} else {
    Write-Host "FAILED - Exit code $LASTEXITCODE" -ForegroundColor Red
}
