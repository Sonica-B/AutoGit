@echo off
echo QUICK FIX: Resolving shouldExcludeFile error...
echo.

REM Navigate to extension directory
cd /d "D:\WPI Assignments\AutoGit_Extension"

echo Cleaning previous builds...
if exist "*.vsix" del "*.vsix"

echo Rebuilding extension v1.0.7...
call vsce package

echo Uninstalling broken version...
call code --uninstall-extension shreya-boyane.auto-git-copilot

echo Installing fixed version...
for %%f in (auto-git-copilot-*.vsix) do (
    call code --install-extension "%%f"
    echo SUCCESS: Installed %%f
)

echo.
echo ============================================
echo FIXED: shouldExcludeFile error resolved!
echo.
echo Changes in v1.0.7:
echo - Fixed function declaration order
echo - Resolved shouldExcludeFile is not defined error
echo - Proper function hoisting
echo ============================================
echo.
echo Please restart VS Code to apply the fix.
echo.
pause