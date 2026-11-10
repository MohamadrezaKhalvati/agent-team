import { chmodSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Apply and read back ACLs; no localized icacls output parsing or shell-built paths.
const ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$paths = ConvertFrom-Json $env:TEAM_MONITOR_PRIVATE_PATHS
foreach ($entry in $paths) {
  $item = Get-Item -LiteralPath $entry.path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point refused' }
  $old = Get-Acl -LiteralPath $entry.path
  if ($old.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unexpected owner' }
  if ($entry.directory) {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  } else {
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
  }
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule($rule)
  $item.SetAccessControl($acl)
  $check = Get-Acl -LiteralPath $entry.path
  $rules = @($check.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if (!$check.AreAccessRulesProtected -or $check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1) { throw 'ACL verification failed' }
  $r = $rules[0]
  if ($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow' -or $r.IsInherited -or $r.FileSystemRights -ne 'FullControl') { throw 'Unexpected ACL rule' }
}
`;
export function protectPaths(paths, {platform=process.platform, execute=spawnSync}={}) {
  const entries=paths.flatMap(path=>{
    const stat=lstatSync(path,{throwIfNoEntry:false});if(!stat)return [];
    if(stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))throw new Error('Monitor private paths must be regular files or directories');
    return [{path,directory:stat.isDirectory()}];
  });
  if(platform==='win32') {
    const executable=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=execute(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ACL_SCRIPT,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:30000,env:{...process.env,TEAM_MONITOR_PRIVATE_PATHS:JSON.stringify(entries)}});
    if(result.error || result.status!==0)throw new Error('Cannot establish private Windows monitor ACLs');
  } else {
    for(const entry of entries) {
      chmodSync(entry.path,entry.directory?0o700:0o600);
      const stat=lstatSync(entry.path);
      if(stat.uid!==process.getuid() || (stat.mode&0o777)!==(entry.directory?0o700:0o600))throw new Error('Cannot establish private POSIX monitor permissions');
    }
  }
}
