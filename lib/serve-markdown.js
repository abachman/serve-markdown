const EventEmitter = require('events'),
      http = require('http'),
      express = require('express'),
      ws = require('express-ws'),
      marked = require('marked'),
      fs = require('fs'),
      path = require('path'),
      template = require('lodash.template')

const renderer = new marked.Renderer()
const TAG_PREFIX = /^\{([.#].+)\}/

renderer.paragraph = function (text) {
  let classAttr = ''
  let idAttr = ''
  let output = text

  if (TAG_PREFIX.test(text)) {
    let classOrId = TAG_PREFIX.exec(text)[1]
    if (classOrId[0] === '.') {
      classAttr = ` class="${classOrId.slice(1)}"`
    } else if (classOrId[0] === '#') {
      idAttr = ` id="${classOrId.slice(1)}"`
    }

    output = text.replace(TAG_PREFIX, '')
  }

  return `<p${classAttr}${idAttr}>${output}</p>`
}

marked.setOptions({
  renderer: renderer,
  pedantic: false,
  gfm: true,
  tables: true,
  breaks: false,
  sanitize: false,
  smartLists: true,
  smartypants: false,
  xhtml: false
});

class ChangeMonitor extends EventEmitter {}

class Templates {
  constructor() {
    this.cache = {}
  }

  load(view) {
    const fpath = path.join(__dirname, 'views', `${view}.html`)
    this.cache[view] = template(fs.readFileSync(fpath))
  }

  render(view, ctx) {
    if (!this.cache[view]) { this.load(view) }
    return this.cache[view](ctx)
  }
}

class Server {
  constructor(config={}) {
    this.port = config.port
    this.filename = config.filename
    this.formatted = ''
    this.changes = new ChangeMonitor()
    this.templates = new Templates()
    this._failure_to_bind = 0

    this.update()
    this.server = this.serve()
  }

  // reopen, read, and markdown format the original file
  update() {
    this.formatted = marked(fs.readFileSync(this.filename, 'utf8'))
  }

  // just enough HTML
  _handleIndex(req, res) {
    console.log("_handleIndex")
    res.send(this.templates.render('index', { port: this.port, title: this.filename }))
  }

  // serve the formatted markdown file
  _handleHtml(req, res) {
    console.log("serving", this.formatted.length, "bytes")

    res.send(JSON.stringify({
      contents: this.formatted,
      ts: new Date().toISOString()
    }))
  }

  // handle incoming websocket connection
  _handleSocket(ws, req) {
    console.log("websocket connected")

    this.changes.on('change', function pinger() {
      console.log("app.ws got change event")
      try {
        ws.send('change')
      } catch (ex) {
        console.error("error publishing on socket")
        this.changes.removeListener('change', pinger)
      }
    })
  }

  serve() {
    const app = express();
    const static_path = path.join(__dirname, 'public')
    app.use(express.static(static_path));
    const expressWs = ws(app);

    fs.watch(this.filename, (evt, fn) => {
      console.log("fs.watch event detected (", evt, fn, ")")

      if (evt === 'change') {
        this.update()
      }

      this.changes.emit('change')
    })

    app.ws('/changes', this._handleSocket.bind(this))
    app.get('/', this._handleIndex.bind(this))
    app.get('/html', this._handleHtml.bind(this))

    app.listen(this.port)

    console.log("listening for changes to", this.filename,
                "serving at http://localhost:" + this.port)
  }
}

module.exports = Server
