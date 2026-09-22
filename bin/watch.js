// JScript (WSH) — run by wscript.exe from a Startup .lnk so the logon helper
// never allocates a console window. WScript has no fs module, so this only
// shells out to enable.cmd hidden and exits.
//
// ASCII only: WSH reads the file with the ANSI codepage.

var sh = new ActiveXObject("WScript.Shell");
var here = WScript.ScriptFullName.replace(/[\\/][^\\/]*$/, "");
var cmd = here + "\\enable.cmd";
sh.Run('"' + cmd + '" --watch --quiet', 0, false);
