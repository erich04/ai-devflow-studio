import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  migrateLocalStoreSchema,
  readLocalStoreSchemaVersion,
  schemaMigrationVersions,
} from './local-store-schema'

const require = createRequire(import.meta.url)
const sqlJsDist = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))

function readMigrationSourceDigests(): string[] {
  const schemaPath = path.join(process.cwd(), 'apps/desktop/electron/local-store-schema.ts')
  const source = readFileSync(schemaPath, 'utf8').replace(/\r\n/gu, '\n')
  const sourceFile = ts.createSourceFile(
    schemaPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  let migrations: ts.ArrayLiteralExpression | undefined
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return
    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'schemaMigrations' &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        migrations = declaration.initializer
      }
    }
  })
  if (!migrations) throw new Error('schemaMigrations source declaration is missing')
  return migrations.elements.map((migration) =>
    createHash('sha256').update(migration.getText(sourceFile)).digest('hex'),
  )
}

describe('LocalStore schema boundary', () => {
  it('keeps every historical migration contiguous and hash-locked', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(31)
    expect(schemaMigrationVersions).toEqual(
      Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1),
    )
    expect(readMigrationSourceDigests()).toEqual([
      'cafc53b00be85cec3c51da4e96ad3df26f5562c56ca505b6735d4a02e6312160',
      '22c943617cea69923cde67805a85fb26f67d39275f5af0c2cbd9f764e505dc4b',
      'b1f1fd9907bcbb57497261c598f953b27495a6115e6f418e36a51f1faa290adf',
      '0d740a7e497b43eabd611766930741d99967f200e4312f2e256934e6c80d29e9',
      '70b9e54754579cf8345d308cde94d691578451555f760049a979d67769fcda30',
      'd762ff7c4f629cb76fb5af407d419af657ce3e4c84f640d06c2c7a7da3293a55',
      'd4dfe6a4f5de32f175dddbd321d091839f2d49d2937cc107e2a7c33d3c20e425',
      '3d1e710c20ee1eabeab5f4c276e8be72787c5586dbde84e231db14bd5fca5d68',
      '9b2e1a53c43b49d3bdef45d7c4ae1f6e1d30afcee6ebdb418f16e5717fcb2cdb',
      '0b090bdaf6a6bfb75fcef5155ee5042098c34306abde4c79e74b72d6a2f81809',
      '9216611c2ae6705b9a949a02464c6f1ea7c96cc391323bd1830b9b684d00ab87',
      'bc5e26e03084d4c52b360e54245ff8f952ae51659a775b070135a95aa3ed0bc3',
      '93048fe4ac5a406b4f652ea5ecbb2afa6c93ad405efd640d65bcb532da85b678',
      '4940666ac8e7c085a496993abf7e2a4d2a956a90ac45ba92cc644a703b5d025f',
      '290ab4d8f488ab9c2ac1deceff0ee40de149934b95f358aaa9e19905b0bdd014',
      '35a78708a0679d6e83dab05dcdb79c3e88a8f1687a8e1706529f6cbbe77b7fc7',
      'd6bdc898fe03cecc7e7ec62d1f4675276289cf584138c30d11a8288c002b1d1c',
      '040be96949d6d9864b78ef47907b4072db19fbf1b7948bf1cb56598c29f3f887',
      '9cd1be41511b1a249f000a12e7cfa54b8590d238a35f943470699d6a1cf83d88',
      '3fb0428da79f1f8049eca0366c63d669c91833b6ea4e5a2e507506b8fd07e184',
      '5e34d6c123e3896ce042c9c8d6e3618c40633131d686cd08c89f8d14a4613b59',
      'b576c7d2163a31fc897a8eeae254e9b01412b341b38671307d13c76da3a636fd',
      '53e3a94b2aeb3b356efc2f34e9b5a93578890695f553d2ee199b672886ab1366',
      'cdf56ca0b7474686e5ab6887dbc54705d7cd79dbff6f02673ccbcb306f5d8720',
      '83edb2196ebcda3761bf1026b83d4338286cd38cf3fdc22c2a1b11487561f4a3',
      'bb67fa32b004b73bd5e1399a6c7b44c88b0396dea6a393ae42620e7d27fda810',
      'e1d27cf7ac5923d19117d7d26fab319bb9c1eb6ec11e83cc9ed20446113c1878',
      '48ce303c0658fd249407711b5e7515f136baeb9e21a601c3b6c67fadd2c82fe6',
      '635e4119684925392f13e79643e3fc34fd2a46596030df21ebcfc902c0de4c63',
      '7f2e38115fd440216259ea912ec2c59eca45180e8438f7402a99515cf9faf764',
      '5c833d94c3909d51b6203f70f54a677e68300299d794be57ba58f646e071b904',
    ])
  })

  it('runs privacy maintenance only after every schema migration commits', async () => {
    const SQL = await initSqlJs({
      locateFile: (fileName) => path.join(sqlJsDist, fileName),
    })
    const db = new SQL.Database()
    const afterMigrations = vi.fn(() => {
      expect(readLocalStoreSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION)
      expect(
        db.exec("select name from sqlite_master where type = 'table' and name = 'github_delivery_content_scans'")[0]
          ?.values,
      ).toEqual([['github_delivery_content_scans']])
    })

    migrateLocalStoreSchema(db, {
      migrateWorkflowRunsIntoRelationalTables: () => undefined,
      afterMigrations,
    })

    expect(afterMigrations).toHaveBeenCalledOnce()
    db.close()
  })
})
