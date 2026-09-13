[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$Manifest=(Join-Path $PSScriptRoot 'release/verified.json'),[switch]$VerifyOnly)
$ErrorActionPreference='Stop'
$release=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$executable=[IO.Path]::GetFullPath([string]$release.executable)
$buildRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'release/builds'))+[IO.Path]::DirectorySeparatorChar
if(-not $executable.StartsWith($buildRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($executable) -ne 'OpenPad.exe'){throw 'Verified executable must be an OpenPad build in this repository.'}
$directory=Split-Path -Parent $executable
$archive=Join-Path $directory 'resources/app.asar'
# A lexical prefix alone cannot establish containment when a parent is a junction.
foreach($candidate in @($executable,$archive)){
  $entry=Get-Item -LiteralPath $candidate
  while($entry){
    if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Build paths containing symbolic links or junctions cannot be registered.'}
    $entry=if($entry -is [IO.DirectoryInfo]){$entry.Parent}else{$entry.Directory}
  }
}
if($release.exeSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or $release.asarSha256 -notmatch '^[A-Fa-f0-9]{64}$'){throw 'Verified manifest is missing SHA-256 digests.'}
if((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $release.exeSha256 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $release.asarSha256){throw 'Build hashes differ from the verified manifest. Registration was not changed.'}
$commandKey='HKCU:\Software\Classes\Applications\OpenPad.exe\shell\open\command'
$appKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\OpenPad.exe'
$shortcutPath=Join-Path ([Environment]::GetFolderPath('Programs')) 'OpenPad.lnk'
$command='"'+$executable+'" "%1"'
if($VerifyOnly){[pscustomobject]@{Executable=$executable;OpenCommand=$command;Shortcut=$shortcutPath;Verified=$true};return}
if($PSCmdlet.ShouldProcess($executable,'Register OpenPad for this Windows user')){
  $backup=Join-Path $PSScriptRoot ('release/registration/'+[guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  $oldCommand=if(Test-Path -LiteralPath $commandKey){(Get-Item -LiteralPath $commandKey).GetValue('')}else{$null}
  $oldApp=if(Test-Path -LiteralPath $appKey){(Get-Item -LiteralPath $appKey).GetValue('')}else{$null}
  $oldDirectory=if(Test-Path -LiteralPath $appKey){(Get-Item -LiteralPath $appKey).GetValue('Path')}else{$null}
  [pscustomobject]@{OpenCommand=$oldCommand;AppPath=$oldApp;AppDirectory=$oldDirectory;Shortcut=$shortcutPath;ShortcutExisted=(Test-Path -LiteralPath $shortcutPath)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'previous.json') -Encoding utf8
  if(Test-Path -LiteralPath $shortcutPath){Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $backup 'OpenPad.lnk')}
  New-Item -Path $commandKey -Force | Out-Null
  Set-Item -LiteralPath $commandKey -Value $command
  New-Item -Path $appKey -Force | Out-Null
  Set-Item -LiteralPath $appKey -Value $executable
  New-ItemProperty -LiteralPath $appKey -Name 'Path' -Value $directory -PropertyType String -Force | Out-Null
  $shell=New-Object -ComObject WScript.Shell
  $shortcut=$shell.CreateShortcut($shortcutPath);$shortcut.TargetPath=$executable;$shortcut.WorkingDirectory=$directory;$shortcut.Arguments='';$shortcut.IconLocation=$executable+',0';$shortcut.Description='OpenPad text editor';$shortcut.Save()
  $saved=$shell.CreateShortcut($shortcutPath)
  if((Get-Item -LiteralPath $commandKey).GetValue('') -ne $command -or (Get-Item -LiteralPath $appKey).GetValue('') -ne $executable -or (Get-Item -LiteralPath $appKey).GetValue('Path') -ne $directory -or $saved.TargetPath -ne $executable -or $saved.Arguments -ne '' -or $saved.WorkingDirectory -ne $directory -or $saved.IconLocation -ne ($executable+',0')){throw 'Registration read-back did not match. The prior configuration is saved in '+$backup}
  [pscustomobject]@{Executable=$executable;Shortcut=$shortcutPath;Backup=$backup;Registered=$true}
}
