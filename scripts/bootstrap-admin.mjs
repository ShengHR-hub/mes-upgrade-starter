import mysql from '../backend/node_modules/mysql2/promise.js'
import { hash } from '../backend/node_modules/@node-rs/argon2/index.js'

const required = ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_DATABASE', 'MES_BOOTSTRAP_PASSWORD']
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`)
}

const username = process.env.MES_BOOTSTRAP_USERNAME || 'admin'
const password = process.env.MES_BOOTSTRAP_PASSWORD
if (password.length < 1 || password.length > 64) throw new Error('Password length must be 1-64 characters')

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE,
  charset: process.env.DB_CHARSET || 'utf8mb4',
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
})

try {
  const [rows] = await connection.execute(
    'SELECT id, password_hash, enabled, role FROM sys_user WHERE username = ? LIMIT 1',
    [username],
  )
  const user = rows[0]
  if (!user) throw new Error(`User not found: ${username}`)
  if (Number(user.enabled) !== 1 || user.role !== 'admin') {
    throw new Error('Target user must be an enabled admin')
  }
  if (typeof user.password_hash === 'string' && user.password_hash.startsWith('$argon2id$')) {
    throw new Error('Target user already has a usable password; no change was made')
  }

  const passwordHash = await hash(password)
  await connection.execute('UPDATE sys_user SET password_hash = ? WHERE id = ?', [passwordHash, user.id])
  console.log(`Initialized password for admin account '${username}'. The password was not printed.`)
} finally {
  await connection.end()
}
