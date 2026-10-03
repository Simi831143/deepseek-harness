/**
 * Replaces this process's token default DACL with the one an elevated
 * Explorer launch inherits when UAC is disabled (`BA:GA SY:GA LOGON:GXGR`,
 * no user ACE), then spawns argv detached so the child has no console to
 * share. Prints the child's `{ status, stdout, stderr }` as JSON.
 */
import { spawn } from 'node:child_process'
import koffi from 'koffi'

const advapi32 = koffi.load('advapi32.dll')
const kernel32 = koffi.load('kernel32.dll')
const getCurrentProcess = kernel32.func('void * __stdcall GetCurrentProcess()')
const openProcessToken = advapi32.func('int __stdcall OpenProcessToken(void *process, uint32 access, _Out_ void **token)')
const getTokenInformation = advapi32.func('int __stdcall GetTokenInformation(void *token, int cls, void *info, uint32 length, _Out_ uint32 *needed)')
const setTokenInformation = advapi32.func('int __stdcall SetTokenInformation(void *token, int cls, void *info, uint32 length)')
const convertSidToStringSid = advapi32.func('int __stdcall ConvertSidToStringSidW(void *sid, _Out_ void **text)')
const convertSddlToSecurityDescriptor = advapi32.func(
  'int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 sddl, uint32 revision, _Out_ void **descriptor, _Out_ uint32 *size)',
)
const getSecurityDescriptorDacl = advapi32.func(
  'int __stdcall GetSecurityDescriptorDacl(void *descriptor, _Out_ int *present, _Out_ void **dacl, _Out_ int *defaulted)',
)

const TOKEN_QUERY = 0x8
const TOKEN_ADJUST_DEFAULT = 0x80
const TOKEN_GROUPS = 2
const TOKEN_DEFAULT_DACL = 6
const SE_GROUP_LOGON_ID = 0xC0000000

/** Throw when a Win32 BOOL call returned FALSE; koffi returns `any` for `int` results. */
function check(ok: unknown, api: string): void {
  if (ok === 0) throw new Error(`${api} failed`)
}

const token: [unknown] = [null]
check(openProcessToken(getCurrentProcess(), TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, token), 'OpenProcessToken')
const needed = [0]
getTokenInformation(token[0], TOKEN_GROUPS, null, 0, needed) // expected to fail with ERROR_INSUFFICIENT_BUFFER
const groups = Buffer.alloc(needed[0] ?? 0)
check(getTokenInformation(token[0], TOKEN_GROUPS, groups, groups.length, needed), 'GetTokenInformation(TokenGroups)')
let logonSid: string | undefined
for (let index = 0; index < groups.readUInt32LE(0); index++) {
  const offset = 8 + index * 16
  if (((groups.readUInt32LE(offset + 8) & SE_GROUP_LOGON_ID) >>> 0) !== SE_GROUP_LOGON_ID) continue
  const text: [unknown] = [null]
  check(convertSidToStringSid(koffi.decode(groups, offset, 'void *'), text), 'ConvertSidToStringSidW')
  logonSid = koffi.decode(text[0], 'char16_t', -1) as string
}
if (logonSid === undefined) throw new Error('no logon SID in the token groups')

const descriptor: [unknown] = [null]
check(convertSddlToSecurityDescriptor(`D:(A;;GA;;;BA)(A;;GA;;;SY)(A;;GXGR;;;${logonSid})`, 1, descriptor, [0]), 'ConvertStringSecurityDescriptorToSecurityDescriptorW')
const dacl: [unknown] = [null]
check(getSecurityDescriptorDacl(descriptor[0], [0], dacl, [0]), 'GetSecurityDescriptorDacl')
const defaultDacl = Buffer.alloc(8)
defaultDacl.writeBigUInt64LE(koffi.address(dacl[0]), 0)
check(setTokenInformation(token[0], TOKEN_DEFAULT_DACL, defaultDacl, defaultDacl.length), 'SetTokenInformation(TokenDefaultDacl)')

const [command, ...args] = process.argv.slice(2)
if (command === undefined) throw new Error('usage: admin-default-dacl-launch.ts <command> [args...]')
const child = spawn(command, args, { detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
child.on('close', (status) => {
  process.stdout.write(JSON.stringify({ status, stdout, stderr }))
})
