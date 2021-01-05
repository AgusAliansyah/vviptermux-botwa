let { WAConnection: _WAConnection, WA_MESSAGE_STUB_TYPES } = require('@adiwajshing/baileys')
let { generate } = require('qrcode-terminal')
let simple = require('./lib/simple')
let yargs = require('yargs/yargs')
let syntaxerror = require('syntax-error')
let chalk = require('chalk')
let fs = require('fs')
let path = require('path')
let util = require('util')
let WAConnection = simple.WAConnection(_WAConnection)
global.conn = new WAConnection()

let opts = yargs(process.argv.slice(2)).exitProcess(false).parse()
let prefix = new RegExp('^[' + (opts['prefix'] || '\\/i!#$%.') + ']')

let authFile = `${opts._[0] || 'session'}.data.json`
fs.existsSync(authFile) && conn.loadAuthInfo(authFile)
opts['big-qr'] && conn.on('qr', qr => generate(qr, { small: false }))
conn.on('credentials-updated', () => fs.writeFileSync(authFile, JSON.stringify(conn.base64EncodedAuthInfo())))

conn.handler = async function (m) {
  try {
  	simple.smsg(this, m)
    if (!m.text) return
    if (m.isBaileys) return
  	let usedPrefix
  	for (let name in global.plugins) {
  	  let plugin = global.plugins[name]
      if (!plugin) continue
      let _prefix = plugin.customPrefix ? plugin.customPrefix : prefix
  	  if ((usedPrefix = (_prefix.exec(m.text) || '')[0])) {
  		  let args = m.text.replace(usedPrefix, '').split` `.filter(v=>v)
  		  let command = (args.shift() || '').toLowerCase()
        let isOwner = m.fromMe
  			let isAccept = plugin.command instanceof RegExp ? plugin.command.test(command) :
        plugin.command instanceof Array ? plugin.command.includes(command) :
        plugin.command instanceof String ? plugin.command == command : false
  			if (!isAccept) continue
        let isMods = isOwner || global.mods.includes(m.sender)
        let isPrems = isMods || global.prems.includes(m.sender)
        let participants = m.isGroup ? (await this.groupMetadata(m.chat)).participants : []
        let user = m.isGroup ? participants.filter(u => u.jid == m.sender)[0] : {}
        let bot = m.isGroup ? participants.filter(u => u.jid == this.user.jid)[0] : {}
        let isAdmin = user.isAdmin || user.isSuperAdmin || false
        let isBotAdmin = bot.isAdmin || bot.isSuperAdmin || false
        let fail = plugin.fail || global.dfail
        if (plugin.owner && !isOwner) {
          fail('owner', m, this)
          continue
        }
        if (plugin.mods && !isMods) {
          fail('mods', m, this)
          continue
        }
        if (plugin.premium && !isPrems) {
          fail('premium', m, this)
          continue
        }
  			if (plugin.group && !m.isGroup) {
          fail('group', m, this)
          continue
        } else if (plugin.botAdmin && !isBotAdmin) {
          fail('botAdmin', m, this)
          continue
        } else if (plugin.admin && !isAdmin) {
          fail('admin', m, this)
          continue
        }
  			if (plugin.private && m.isGroup) {
          fail('private', m, this)
          continue
        }

        await plugin(m, { usedPrefix, args, command, conn: this }).catch(e => this.reply(m.chat, util.format(e), m))
        isCommand = true
  			break
  		}
  	}
  } finally {
    try {
      require('./lib/print')(m, this)
    } catch (e) {
      console.log(m, e)
    }
  }
}

conn.on('message-new', conn.handler) 

global.mods = ['6289613469459@s.whatsapp.net']
global.prems = ['6289613469459@s.whatsapp.net']

global.dfail = (type, m, conn) => {
  let msg = {
    owner: 'Perintah ini hanya dapat digunakan oleh Owner Nomor!',
    mods: 'Perintah ini hanya dapat digunakan oleh Moderator!',
    premium: 'Perintah ini hanya untuk member Premium!',
    group: 'Perintah ini hanya dapat digunakan di Grup!',
    private: 'Perintah ini hanya dapat digunakan di Chat Pribadi!',
    admin: 'Anda bukan admin grup!',
    botAdmin: 'Jadikan bot sebagai admin untuk menggunakan perintah ini!'
  }[type]
  msg && conn.reply(m.chat, msg, m)
}

!opts['test'] && conn.connect()
opts['test'] && process.stdin.on('data', chunk => conn.emit('message-new', { text: chunk.toString() }))
// let strQuot = /(["'])(?:(?=(\\?))\2.)*?\1/

let pluginFilter = filename => /\.js$/.test(filename)
global.plugins = Object.fromEntries(
  fs.readdirSync(path.join(__dirname, 'plugins'))
    .filter(pluginFilter)
    .map(filename => [filename, {}])
)
for (let filename in global.plugins) {
  try {
    global.plugins[filename] = require('./plugins/' + filename)
  } catch (e) {
    conn.logger.error(e)
    delete global.plugins[filename]
  }
}
console.log(global.plugins)
fs.watch(path.join(__dirname, 'plugins'), (event, filename) => {
  if (pluginFilter(filename)) {
    let dir = './plugins/' + filename
    if (delete require.cache[require.resolve(dir)]) {
      if (fs.existsSync(require.resolve(dir))) conn.logger.info(`re - require plugin '${dir}'`)
      else {
        conn.logger.warn(`deleted plugin '${dir}'`)
        return delete global.plugins[filename]
      }
    } else conn.logger.info(`requiring new plugin '${dir}'`)
    let err = syntaxerror(fs.readFileSync(dir))
    if (err) conn.logger.error(`syntax error while loading '${dir}'\n${err}`)
    else try {
      global.plugins[filename] = require(dir)
    } catch (e) {
      conn.logger.error(e)
    }
  }
})
