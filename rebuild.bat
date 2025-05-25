@echo off
echo Building Auto Git Extension v1.0.6 with improved ignore handling...

REM Navigate to extension directory
cd /d "D:\WPI Assignments\AutoGit_Extension"

REM Clean previous builds
echo Cleaning previous builds...
if exist "*.vsix" del "*.vsix"

REM Install dependencies
echo Installing dependencies...
call npm install

REM Package extension
echo Packaging extension...
call vsce package

REM Uninstall old version
echo Uninstalling old version...
call code --uninstall-extension shreya-boyane.auto-git-copilot

REM Install new version
echo Installing new version...
for %%f in (auto-git-copilot-*.vsix) do (
    call code --install-extension "%%f"
    echo Installed: %%f
)

echo.
echo Extension rebuild complete!
echo.
echo CHANGES IN v1.0.6:
echo - Properly excludes .git internal files
echo - Respects .gitignore and exclude patterns
echo - Individual file staging instead of 'git add .'
echo - Enhanced filtering to prevent git internal commits
echo.
echo Please restart VS Code to apply changes.
echo.
pause