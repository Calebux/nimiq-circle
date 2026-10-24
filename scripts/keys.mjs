#!/usr/bin/env node
// Encrypted, offline backup of the secrets that control members' money.
//
//   npm run keys -- backup <file>    write an encrypted backup (asks for a passphrase twice)
//   npm run keys -- check <file>     decrypt it and confirm it matches .env.local; prints addresses only
//
// The file is AES-256-GCM with a key from scrypt(passphrase). Keep it off this laptop (USB stick,
// password manager) and the passphrase somewhere else. SESSION_SECRET is included because USDT
// payment references are derived from it: without it, unconfirmed USDT payments cannot be matched.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import * as Nimiq from '@nimiq/core'
import { privateKeyToAccount } from 'viem/accounts'

const SECRETS = ['POOL_PRIVATE_KEY', 'EVM_POOL_PRIVATE_KEY', 'GAS_PRIVATE_KEY', 'SESSION_SECRET', 'CRON_SECRET']
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }

function ask(prompt) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) throw new Error('Run this in a terminal so the passphrase stays hidden')
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    let text = ''
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          return resolve(text)
        }
        if (ch === '\u0003') process.exit(1)
        if (ch === '\u007f') text = text.slice(0, -1)
        else text += ch
      }
    }
    process.stdin.on('data', onData)
  })
}

function addresses(secrets) {
  const out = {}
  if (secrets.POOL_PRIVATE_KEY) out['NIM pool'] = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(secrets.POOL_PRIVATE_KEY)).toAddress().toUserFriendlyAddress()
  if (secrets.EVM_POOL_PRIVATE_KEY) out['USDT pool'] = privateKeyToAccount(secrets.EVM_POOL_PRIVATE_KEY).address
  if (secrets.GAS_PRIVATE_KEY) out['Gas wallet'] = privateKeyToAccount(secrets.GAS_PRIVATE_KEY).address
  return out
}

const commands = {
  async backup(file) {
    if (!file) throw new Error('Usage: backup <file>')
    const secrets = Object.fromEntries(SECRETS.filter((k) => process.env[k]).map((k) => [k, process.env[k]]))
    const pass = await ask('Passphrase (12+ characters): ')
    if (pass.length < 12) throw new Error('Use at least 12 characters')
    if ((await ask('Again: ')) !== pass) throw new Error('Passphrases did not match')
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = scryptSync(pass, salt, 32, SCRYPT)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(secrets)), cipher.final()])
    const payload = { v: 1, kdf: 'scrypt', salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }
    writeFileSync(file, JSON.stringify(payload), { mode: 0o600 })
    console.log(`✓ Wrote ${file} (${Object.keys(secrets).join(', ')})`)
    for (const [k, v] of Object.entries(addresses(secrets))) console.log(`  ${k.padEnd(10)} ${v}`)
    console.log('Move it off this laptop, then run `check` on the copy.')
  },

  async check(file) {
    if (!file) throw new Error('Usage: check <file>')
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    const pass = await ask('Passphrase: ')
    const key = scryptSync(pass, Buffer.from(payload.salt, 'hex'), 32, SCRYPT)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'))
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'))
    let secrets
    try {
      secrets = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'hex')), decipher.final()]).toString('utf8'))
    } catch {
      throw new Error('Wrong passphrase, or the file is damaged')
    }
    console.log('✓ Decrypted')
    for (const [k, v] of Object.entries(addresses(secrets))) console.log(`  ${k.padEnd(10)} ${v}`)
    for (const k of SECRETS) {
      if (!process.env[k]) continue
      console.log(`  ${k.padEnd(20)} ${secrets[k] === process.env[k] ? 'matches .env.local' : 'DIFFERENT from .env.local'}`)
    }
  },
}

const [name, ...args] = process.argv.slice(2)
if (!commands[name]) {
  console.log(`Commands: ${Object.keys(commands).join(', ')}`)
  process.exit(name ? 1 : 0)
}
try {
  await commands[name](...args)
  process.exit(0)
} catch (err) {
  console.error(`✗ ${err.message}`)
  process.exit(1)
}
