!include "LogicLib.nsh"

Var dshFinalDirectory
Var dshNewDirectory
Var dshOldDirectory
Var dshOldMoved
Var dshNewMoved

!macro dshExtractPayload FILE
  !ifmacrodef customInstallerExtract
    !insertmacro customInstallerExtract "${FILE}"
  !else
    nsExec::ExecToStack '"$PLUGINSDIR\dsh-7za.exe" x -y -bd -bb0 "-o$INSTDIR" "${FILE}"'
    Pop $R0
    Pop $R1
  !endif
  ${If} $R0 != 0
    DetailPrint $R1
    Call dshRollbackDirectories
    !ifmacrodef customInstallerExtractFailed
      !insertmacro customInstallerExtractFailed "${FILE}"
    !else
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)" /SD IDOK
    !endif
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro dshStageApplication
  StrCpy $dshFinalDirectory $INSTDIR
  System::Call 'ole32::CoCreateGuid(g .r0) i .r1'
  ${If} $1 != 0
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $dshNewDirectory "$INSTDIR.new-$0"
  StrCpy $dshOldDirectory "$INSTDIR.old-$0"
  StrCpy $dshOldMoved ""
  StrCpy $dshNewMoved ""
  ClearErrors
  CreateDirectory $dshNewDirectory
  ${If} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
  ; The application reads this PID before touching staged siblings, so a launch during installation leaves them alone.
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  ClearErrors
  FileOpen $1 "$dshFinalDirectory.installing" w
  ${IfNot} ${Errors}
    FileWrite $1 "$0"
    FileClose $1
  ${EndIf}
  File /oname=$PLUGINSDIR\dsh-7za.exe "${DSH_SEVENZIP_PATH}"
  StrCpy $INSTDIR $dshNewDirectory
  SetOutPath $INSTDIR
  !insertmacro installApplicationFiles
  !ifdef DSH_SEVENZIP_LICENSE_DIR
    File /oname=7zip-installer-LICENSE.txt "${DSH_SEVENZIP_LICENSE_DIR}\LICENSE.txt"
    File /oname=7zip-installer-COPYING.txt "${DSH_SEVENZIP_LICENSE_DIR}\COPYING"
  !endif
  !ifdef UNINSTALLER_ICON
    File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
  !endif
  StrCpy $INSTDIR $dshFinalDirectory
  SetOutPath $PLUGINSDIR
!macroend

Function .onGUIEnd
  Call dshCleanupDirectories
FunctionEnd

Function dshCleanupDirectories
  ${If} $dshFinalDirectory != ""
    Call dshRollbackDirectories
    Delete "$dshFinalDirectory.installing"
  ${EndIf}
FunctionEnd

; Only directories created or renamed by this installer are removed during rollback.
Function dshRollbackDirectories
  SetOutPath $PLUGINSDIR
  ${If} $dshNewMoved == "1"
    RMDir /r "\\?\$dshFinalDirectory"
    StrCpy $dshNewMoved ""
  ${EndIf}
  ${If} $dshOldMoved == "1"
    ClearErrors
    Rename $dshOldDirectory $dshFinalDirectory
    ${If} ${Errors}
      ; Leave the complete backup in place if another process prevents restoration.
      DetailPrint $dshOldDirectory
      Return
    ${EndIf}
    StrCpy $dshOldMoved ""
  ${EndIf}
  ${If} $dshNewDirectory != ""
    RMDir /r "\\?\$dshNewDirectory"
  ${EndIf}
  StrCpy $INSTDIR $dshFinalDirectory
FunctionEnd

; Rename $R6 to $R7, retrying while another process holds a handle in either tree. Endpoint security scans every
; file of a freshly extracted unsigned tree and an exiting application releases its files late, so a rename can
; fail for tens of seconds without any process Restart Manager can name. Leaves "renamed" in $R5 on success.
; ${Errors} clears the flag it tests, so the outcome is kept in $R5 rather than re-tested after the loop.
Function dshRenameWithRetry
  StrCpy $R5 0
  ${Do}
    ClearErrors
    Rename $R6 $R7
    ${IfNot} ${Errors}
      StrCpy $R5 "renamed"
      ${ExitDo}
    ${EndIf}
    IntOp $R5 $R5 + 1
    ; 240 attempts 250 ms apart: one minute.
    ${If} $R5 >= 240
      ${ExitDo}
    ${EndIf}
    Sleep 250
  ${Loop}
FunctionEnd

Function dshPromoteDirectories
  !ifmacrodef InstallerPublishStage
    !insertmacro InstallerPublishStage 2
  !endif
  ; SetOutPath opens a directory handle; release it before either rename.
  SetOutPath $PLUGINSDIR
  Push $R5
  Push $R6
  Push $R7
  ClearErrors
  ${If} ${FileExists} "$dshFinalDirectory\*.*"
    StrCpy $R6 $dshFinalDirectory
    StrCpy $R7 $dshOldDirectory
    Call dshRenameWithRetry
    ${If} $R5 != "renamed"
      Pop $R7
      Pop $R6
      Pop $R5
      Call dshRollbackDirectories
      SetErrors
      Return
    ${EndIf}
    StrCpy $dshOldMoved "1"
  ${Else}
    ; NSIS can create the destination before the install section starts.
    RMDir $dshFinalDirectory
  ${EndIf}
  StrCpy $R6 $dshNewDirectory
  StrCpy $R7 $dshFinalDirectory
  Call dshRenameWithRetry
  ${If} $R5 != "renamed"
    Pop $R7
    Pop $R6
    Pop $R5
    Call dshRollbackDirectories
    SetErrors
    Return
  ${EndIf}
  Pop $R7
  Pop $R6
  Pop $R5
  StrCpy $dshNewMoved "1"
  SetOutPath $dshFinalDirectory
  !ifmacrodef InstallerPublishStage
    !insertmacro InstallerPublishStage 3
  !endif
  ClearErrors
FunctionEnd

!macro dshFinishDirectories
  StrCpy $dshNewMoved ""
  ${If} $dshOldMoved == "1"
    RMDir /r "\\?\$dshOldDirectory"
    StrCpy $dshOldMoved ""
  ${EndIf}
  Delete "$dshFinalDirectory.installing"
!macroend
