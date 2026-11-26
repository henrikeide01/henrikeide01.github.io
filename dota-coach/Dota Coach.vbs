' Starter Dota Coach som en vanlig app, uten det svarte vinduet.
' Foerste gang (eller etter en oppdatering som trenger installasjon) vises vinduet, saa du ser installasjonen.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
bat = Chr(34) & dir & "\Dota Coach.bat" & Chr(34)
If fso.FolderExists(dir & "\node_modules\electron") And Not fso.FileExists(dir & "\.needs-install") Then
  sh.Run bat, 0, False
Else
  sh.Run bat, 1, False
End If
