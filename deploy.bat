@echo off
setlocal
cd /d "%~dp0"
title Deploy Cannonhill

echo(
echo  ============================================
echo   Deploy Cannonhill to GitHub Pages
echo  ============================================
echo(

REM --- show what changed ---
git status --short
echo(

REM --- bail out early if there is nothing to deploy (incl. new files) ---
set "DIRTY="
for /f "delims=" %%i in ('git status --porcelain') do set "DIRTY=1"
if not defined DIRTY (
  echo  No changes to deploy. Nothing to do.
  echo(
  pause
  exit /b 0
)

REM --- ask for a commit message (with a sensible default) ---
set "MSG="
set /p "MSG=Describe your change (press Enter for 'Update game'): "
if "%MSG%"=="" set "MSG=Update game"

echo(
echo  Staging, committing and pushing...
echo(

git add -A
git commit -m "%MSG%"
if errorlevel 1 (
  echo(
  echo  Commit failed ^(see message above^). Aborting.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo(
  echo  Push failed. If it says 'fetch first', run:  git pull --rebase
  echo  then double-click this file again.
  pause
  exit /b 1
)

echo(
echo  ============================================
echo   Pushed!  GitHub is now building your site.
echo(
echo   Watch progress:  Actions tab of your repo
echo   Live in ~1 min:  https://thesistwogo-ux.github.io/cannonhill/
echo  ============================================
echo(
echo  Tip: on your iPhone, fully close and reopen the app
echo  to pick up the new version.
echo(
pause
