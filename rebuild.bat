@echo off
setlocal
REM Rebuild and reinstall the AutoGit-AI extension from this directory.
cd /d "%~dp0"

echo Cleaning previous builds...
if exist "*.vsix" del "*.vsix"

echo Running tests...
call npm test
if errorlevel 1 (
    echo Tests failed - aborting build.
    exit /b 1
)

echo Packaging extension...
call npx @vscode/vsce package
if errorlevel 1 (
    echo Packaging failed.
    exit /b 1
)

echo Uninstalling previous version...
call code --uninstall-extension ShreyaBoyane.auto-git-copilot

echo Installing new version...
for %%f in (auto-git-copilot-*.vsix) do (
    call code --install-extension "%%f"
    echo Installed %%f
)

echo.
echo Done. Restart VS Code to load the new version.
pause
