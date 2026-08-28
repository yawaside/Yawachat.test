; YawaMetrics Inno Setup installer (TECHNICAL_SPEC 9.2).
; Version is checked by .github/scripts/check-version.mjs — keep in sync.

#define MyAppName "YawaMetrics"
#define MyAppVersion "2.1.1"
#define MyAppPublisher "yawaside"
#define MyAppURL "https://github.com/yawaside/YawaMetricks.OBS.plugin"
#define MyAppExeName "obs64.exe"

; StagingDir is passed by CI (iscc /DStagingDir=...); default for local builds.
#ifndef StagingDir
#define StagingDir "..\package\staging"
#endif

[Setup]
AppId={{7C1E68B4-93A1-4F1D-9C68-5E77A9B8D401}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={code:GetObsDir}
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
OutputBaseFilename=yawametrics-{#MyAppVersion}-windows-x64-setup
OutputDir=.
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesOverridesAllowed=dialog
; OBS может стоять в Program Files (нужен admin) или в %LOCALAPPDATA% (без admin).
PrivilegesRequired=lowest

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ru.ObsNotFound=Не удалось найти OBS Studio автоматически.%nУкажите каталог OBS Studio вручную.
ru.NotObsDir=В выбранном каталоге нет obs-plugins\64bit — это точно каталог OBS Studio?
en.ObsNotFound=Could not detect OBS Studio automatically.%nPlease pick the OBS Studio folder manually.
en.NotObsDir=The selected folder does not contain obs-plugins\64bit — are you sure it is the OBS Studio folder?
ru.RunObs=Запустить OBS Studio
en.RunObs=Launch OBS Studio

[Files]
Source: "{#StagingDir}\obs-plugins\64bit\yawametrics.dll"; DestDir: "{app}\obs-plugins\64bit"; Flags: ignoreversion
Source: "{#StagingDir}\data\obs-plugins\yawametrics\yawametrics.qss"; DestDir: "{app}\data\obs-plugins\yawametrics"; Flags: ignoreversion
Source: "{#StagingDir}\data\obs-plugins\yawametrics\widget.html"; DestDir: "{app}\data\obs-plugins\yawametrics"; Flags: ignoreversion
Source: "{#StagingDir}\data\obs-plugins\yawametrics\locale\ru-RU.ini"; DestDir: "{app}\data\obs-plugins\yawametrics\locale"; Flags: ignoreversion
Source: "{#StagingDir}\data\obs-plugins\yawametrics\locale\en-US.ini"; DestDir: "{app}\data\obs-plugins\yawametrics\locale"; Flags: ignoreversion
Source: "..\installer\README.txt"; DestDir: "{app}\data\obs-plugins\yawametrics"; Flags: ignoreversion skipifsourcedoesnotexist
Source: "..\installer\obs-instructions.txt"; DestDir: "{app}\data\obs-plugins\yawametrics"; Flags: ignoreversion skipifsourcedoesnotexist

[InstallDelete]
; Чистим старые файлы предыдущей версии (§9.3).
Type: files; Name: "{app}\obs-plugins\64bit\yawametrics.dll"
Type: filesandordirs; Name: "{app}\data\obs-plugins\yawametrics"

[UninstallDelete]
Type: files; Name: "{app}\obs-plugins\64bit\yawametrics.dll"
Type: filesandordirs; Name: "{app}\data\obs-plugins\yawametrics"

[Dirs]
Name: "{app}\data\obs-plugins\yawametrics"; Flags: uninsneveruninstall

[Run]
Filename: "{app}\bin\64bit\{#MyAppExeName}"; Description: "{cm:RunObs}"; Flags: nowait postinstall skipifsilent unchecked

[Code]
function ObsDirFromRegistry(Value: string): string;
var
  InstallLocation: string;
begin
  Result := '';
  // HKCU (установка «для себя», OBS 30+ по умолчанию)
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\OBSStudio',
      'InstallLocation', InstallLocation) and (InstallLocation <> '') then begin
    Result := InstallLocation;
    exit;
  end;
  // HKLM 64-bit и WOW6432Node (системная установка)
  if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\OBSStudio',
      'InstallLocation', InstallLocation) and (InstallLocation <> '') then begin
    Result := InstallLocation;
    exit;
  end;
  if RegQueryStringValue(HKLM, 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\OBSStudio',
      'InstallLocation', InstallLocation) and (InstallLocation <> '') then begin
    Result := InstallLocation;
    exit;
  end;
end;

function GetObsDir(Param: string): string;
var
  Dir: string;
begin
  Result := ObsDirFromRegistry('');

  if (Result = '') or (not DirExists(ExpandConstant(Result + '\obs-plugins'))) then begin
    // Стандартные расположения
    Dir := ExpandConstant('{autopf}\obs-studio');
    if DirExists(ExpandConstant(Dir + '\obs-plugins')) then
      Result := Dir
    else begin
      Dir := ExpandConstant('{userappdata}\..\..\Programs\obs-studio');
      if DirExists(ExpandConstant(Dir + '\obs-plugins')) then
        Result := Dir
      else begin
        if Result = '' then
          Result := ExpandConstant('{autopf}\obs-studio');
      end;
    end;
  end;

  StringChangeEx(Result, '/', '\', True);
  while (Length(Result) > 3) and (Copy(Result, Length(Result), 1) = '\') do
    SetLength(Result, Length(Result) - 1);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Dir: string;
begin
  Result := True;
  if CurPageID = wpSelectDir then begin
    Dir := WizardDirValue();
    if not DirExists(ExpandConstant(Dir + '\obs-plugins\64bit')) then begin
      MsgBox(ExpandConstant('{cm:NotObsDir}'), mbConfirmation, MB_OK);
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then begin
    if not DirExists(ExpandConstant('{app}\obs-plugins\64bit')) then begin
      MsgBox(ExpandConstant('{cm:ObsNotFound}'), mbInformation, MB_OK);
    end;
  end;
end;
