import { backupNativeCodingData, restoreNativeCodingData, verifyNativeCodingBackup } from '../apps/desktop/electron/native-coding-backup'

const [action, source, destination, confirmation] = process.argv.slice(2)
if (!source || !['backup', 'verify', 'restore'].includes(action ?? '') || (action !== 'verify' && (!destination || confirmation !== '--app-stopped'))) throw new Error('用法：tsx scripts/native-coding-data.ts backup <原资料目录> <新备份目录> --app-stopped | verify <备份目录> | restore <备份目录> <原资料路径> --app-stopped')
if (action === 'backup') { const manifest = await backupNativeCodingData(source, destination!); console.log(`已备份并校验 ${manifest.files.length} 个文件。目录不含可重建的依赖缓存；请保留原机器密钥链和项目 Git 仓库。`) }
else if (action === 'verify') { const manifest = await verifyNativeCodingBackup(source); console.log(`完整性通过：${manifest.files.length} 个文件。`) }
else { await restoreNativeCodingData(source, destination!); console.log('已恢复到原资料路径。使用支持当前 SQLite 版本的应用打开；不会自动重发未知请求。') }
