/** One-off inspector: dumps every table's columns, row count and a sample row. */
import MDBReader from 'mdb-reader'
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/inspect-accdb.mjs <path-to-.accdb>')
  process.exit(1)
}

const buffer = readFileSync(path)
const reader = new MDBReader(buffer)

const tableNames = reader.getTableNames()
console.log(`Tables (${tableNames.length}):`, tableNames)
console.log('='.repeat(80))

for (const name of tableNames) {
  const table = reader.getTable(name)
  const columns = table.getColumnNames()
  const types = table.getColumns().map((c) => `${c.name}:${c.type}`)
  const data = table.getData()

  console.log(`\n### ${name}  (${data.length} rows)`)
  console.log('columns:', types.join(', '))
  if (data.length > 0) {
    console.log('sample row 1:', JSON.stringify(data[0], null, 2))
  }
  if (data.length > 1) {
    console.log('sample row 2:', JSON.stringify(data[1], null, 2))
  }
}
