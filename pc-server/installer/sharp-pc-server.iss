; SHARP PC 서버 설치 프로그램 (Inno Setup 6). 사용자 단위로 설치하며 관리자 권한이 필요 없다.
; 이 파일은 한국어를 쓰므로 UTF-8 BOM을 유지한다(Inno Setup은 BOM이 없으면 ANSI로 읽는다).
; 빌드: python pc-server/build.py --installer  (SourceDir·AppVersion·OutputDir은 build.py가 /D로 넘긴다)
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #error SourceDir를 /DSourceDir=<배포본 폴더>로 지정하세요.
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#define AppName "Splatia PC Server"
#define LegacyName "SHARP PC Server"
#define AppExe "Splatia PC Server.exe"
#define LegacyExe "SHARP PC Server.exe"
#define MutexName "SHARP_PC_Server_Mutex"

[Setup]
; AppId는 바꾸지 않는다. 바꾸면 업그레이드가 아니라 별개 앱으로 설치된다.
AppId={{56DDD7B8-0E4E-4896-84F2-F3BDF90FC2F6}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=SHARP VR
AppPublisherURL=https://crayonsmilegames.github.io/sharp-quest/support/
AppSupportURL=https://crayonsmilegames.github.io/sharp-quest/support/
DefaultDirName={localappdata}\Programs\{#LegacyName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\assets\app.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
OutputDir={#OutputDir}
OutputBaseFilename=Splatia-PC-Server-{#AppVersion}-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
korean.TaskAutostart=Windows를 시작할 때 자동으로 실행 (트레이에만 표시)
english.TaskAutostart=Start automatically when Windows starts (tray only)
korean.ConfirmDeleteData=저장된 설정과 공유 폴더 목록(%1)도 함께 지울까요?%n%n[아니요]를 누르면 보관합니다. 다시 설치하면 그대로 쓸 수 있습니다.
english.ConfirmDeleteData=Also delete saved settings and the shared folder list (%1)?%n%nChoose No to keep them for a later reinstall.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "autostart"; Description: "{cm:TaskAutostart}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; 1.1.0이 설치한 파일만 정리한다. 설정 폴더와 AppId는 그대로 둔다.
Type: files; Name: "{app}\{#LegacyExe}"
Type: files; Name: "{autoprograms}\{#LegacyName}.lnk"
Type: files; Name: "{autodesktop}\{#LegacyName}.lnk"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; 앱의 관리 창 토글이 쓰는 값과 같다(pc_settings.py). 제거할 때는 아래 [Code]가 값을 지운다.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#LegacyName}"; ValueData: """{app}\{#AppExe}"" --background"; Check: ShouldAutostart

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Code]
function ShouldAutostart: Boolean;
begin
  Result := IsTaskSelected('autostart') or
    RegValueExists(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', '{#LegacyName}');
end;

function DataDir: String;
begin
  Result := ExpandConstant('{localappdata}\{#LegacyName}');
end;

{ 실행 중인 앱에 종료를 요청하고 뮤텍스가 사라질 때까지(최대 약 15초) 기다린다. }
procedure CloseApp;
var
  Exe: String;
  Code, I: Integer;
begin
  Exe := ExpandConstant('{app}\{#AppExe}');
  if not FileExists(Exe) then Exe := ExpandConstant('{app}\{#LegacyExe}');
  if FileExists(Exe) and CheckForMutexes('{#MutexName}') then
  begin
    Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code);
    for I := 1 to 30 do
    begin
      if not CheckForMutexes('{#MutexName}') then Break;
      Sleep(500);
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  CloseApp;
  Result := '';
end;

function InitializeUninstall: Boolean;
begin
  CloseApp;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', '{#LegacyName}');
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) and DirExists(DataDir) then
    if MsgBox(FmtMessage(CustomMessage('ConfirmDeleteData'), [DataDir]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(DataDir, True, True, True);
end;
