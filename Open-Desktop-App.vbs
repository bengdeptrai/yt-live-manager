Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
AppDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = AppDir

' Check if port 3000 is already listening; if not, start node server.js --desktop in background
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.open "GET", "http://127.0.0.1:3000/api/status", False
http.send
If Err.Number <> 0 Or http.status <> 200 Then
    Err.Clear
    WshShell.Run "cmd.exe /c node """ & AppDir & "\server.js"" --desktop", 0, False
Else
    http.open "POST", "http://127.0.0.1:3000/api/open-desktop-app", False
    http.send
End If
