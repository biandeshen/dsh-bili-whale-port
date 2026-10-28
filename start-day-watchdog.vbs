' Start the out-of-process day watchdog hidden (no console window).
' ASCII only: non-ASCII in .vbs/.cmd is parsed as GBK and breaks.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "E:\WorkSpace_Qoder\dsh-bili-whale"
sh.Run "node scripts\day-watchdog.mjs --audit", 0, False
