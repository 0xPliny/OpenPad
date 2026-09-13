; This candidate intentionally supports only the current Windows user's installation.
!macro customInit
  ${If} ${isForAllUsers}
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $hasPerMachineInstallation "0"
  StrCpy $hasPerUserInstallation "1"
  !insertmacro setInstallModePerUser
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
