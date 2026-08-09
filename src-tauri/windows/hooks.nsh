; Preserve autostart across updates. A normal uninstall removes only the exact
; REG_SZ command owned by the Dinotty executable in this installation.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    StrCpy $0 0
    StrCpy $1 0
    StrCpy $2 0
    StrCpy $3 0
    StrCpy $4 ""
    System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "Software\Microsoft\Windows\CurrentVersion\Run", i 0, i 0x20019, *p .r0) i .r1'
    ${If} $1 = 0
      IntOp $2 ${NSIS_MAX_STRLEN} * 2
      System::Call 'advapi32::RegQueryValueExW(p r0, w "Dinotty", p 0, *i .r3, w .r4, *i r2) i .r1'
      System::Call 'advapi32::RegCloseKey(p r0)'
      ; REG_SZ is type 1. REG_EXPAND_SZ and every other type remain untouched.
      ${If} $1 = 0
      ${AndIf} $3 = 1 ; REG_SZ
      ${AndIf} $4 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --background"
        DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Dinotty"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
