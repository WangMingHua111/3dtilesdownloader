const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const axios = require('axios')
const axiosRetry = require('axios-retry')
const _ = require('lodash')
const querystring = require('querystring');
const { URL } = require('url');
const sqlite3 = require('sqlite3').verbose()
const zlib = require('zlib')
const childProcess = require('child_process')
const asyncPool = require('tiny-async-pool')

axiosRetry(axios, { retries: 3 })
const defalutOptions = {
    query: [],
    alias: '3dtiles',
    outdir: '',
    breakpoint: false,
    zip: false,
    clt: true,
    downloaded: true,
    skiped: true,
    parallel: false,
    count: 20,
    limit: 100,
}

function wrap(fn) {
    return new Promise((resolve, reject) => {
        fn(resolve, reject)
    })
}
// 单线程下载器
class tiles3ddownloader {
    constructor(options) {
        this.options = Object.assign({}, defalutOptions, options)

        const { breakpoint, outdir, alias } = this.options
        const cltname = (path.isAbsolute(outdir) ? path.resolve(path.join(outdir, alias)) : path.resolve(path.join(outdir, alias))) + '.clt'

        if (!fs.existsSync(path.dirname(cltname))) fs.mkdirSync(path.dirname(cltname))
        // 如果不是断点续传，删除原始下载文件
        if (!breakpoint) fs.existsSync(cltname) && fs.unlinkSync(cltname)

        this.db = new sqlite3.Database(cltname)
        this.cltname = cltname
    }

    async download(tileset) {
        console.log(`开始下载：${tileset}`)
        const { db, cltname } = this
        const { query, clt, zip, outdir, alias } = this.options
        // 创建瓦片表
        await wrap(resolve => db.run('create table if not exists tiles(md5 varchar(16) primary key not null, path text, tile blob, type varchar(20));', () => resolve()))

        const source = new URL(tileset)
        const searchParams = new URLSearchParams([source.searchParams.toString(), ...query].join('&'))
        const url = new URL(source.pathname.replace(/\\/g, '/'), source.origin)
        for (var pair of searchParams.entries()) {
            url.searchParams.append(pair[0], pair[1])
        }
        this.parsing(url, path.parse(url.pathname).dir.replace(/\\/g, '/')).then(() => {
            if (!clt) {
                try {
                    console.log('执行解包')
                    const cmd = `npx clt2tiles "${cltname}" ${zip ? '--zip ' : ''} ${outdir ? '--outdir ' + outdir : ''} ${alias ? '--alias ' + alias : ''}`
                    childProcess.exec(cmd, { encoding: 'utf8' }, () => {
                        console.log('解包完毕')
                    }).stdout.pipe(process.stdout)

                } catch (err) {
                    console.log(err)
                }
            }
        })
    }

    async parsing(url, root) {
        const { db } = this
        const { downloaded, skiped, zip } = this.options
        const parse = path.parse(url.pathname)

        const subpath = parse.dir.replace(root, '')

        const relative = path.join(subpath, parse.base).replace(/\\/g, '/')
        const md5 = crypto.createHash('md5').update(relative).digest('hex')

        const subfiles = []

        const uri = `${url.origin}${url.pathname}`

        // 这是一个json文件需要进行解析
        if (parse.ext.match(/^.json$/i)) {
            let row = await wrap(resolve => db.get(`SELECT tile FROM tiles WHERE md5 = ?;`, md5, (err, row) => resolve(row)))

            if (row === undefined) {
                const res = await axios.get(uri, { params: querystring.parse(url.searchParams.toString()), responseType: 'arraybuffer' })
                row = {
                    tile: res.data
                }

                await wrap(resolve => db.run('INSERT INTO tiles (md5,path,tile,type) VALUES (?,?,?,?);', [md5, relative, zip ? zlib.gzipSync(row.tile) : row.tile, 'file'], () => resolve()))
                downloaded && console.log(`Downloaded ${uri}`)
            } else {
                row.tile = zip ? zlib.unzipSync(row.tile) : row.tile
                skiped && console.log(`Skiped ${uri}`)
            }

            const jsonStr = row.tile.toString()
            const data = JSON.parse(jsonStr)

            const contenturi = _.get(data, 'root.content.uri')
            const children = _.get(data, 'root.children') || []
            contenturi && subfiles.push(path.join(root, contenturi).replace(/\\/g, '/'))
            children.forEach(element => {
                const childrenuri = _.get(element, 'content.uri')
                children && subfiles.push(path.join(root, childrenuri).replace(/\\/g, '/'))
            })
        } else {
            let row = await wrap(resolve => db.get(`SELECT md5 FROM tiles WHERE md5 = ?;`, md5, (err, row) => resolve(row)))
            // 数据库未检索到该对象，下载并插入到数据库中
            if (row === undefined) {
                const res = await axios.get(uri, { params: querystring.parse(url.searchParams.toString()), responseType: 'arraybuffer' })
                row = {
                    tile: res.data
                }
                await wrap(resolve => db.run('INSERT INTO tiles (md5,path,tile,type) VALUES (?,?,?,?);', [md5, relative, zip ? zlib.gzipSync(row.tile) : row.tile, 'file'], () => resolve()))
                downloaded && console.log(`Downloaded ${uri}`)
            } else {
                skiped && console.log(`Skiped ${uri}`)
            }
        }
        for (let i = 0; i < subfiles.length; i++) {
            url.pathname = subfiles[i]
            await this.parsing(url, root)
        }
    }
}
// 并行下载器
class tiles3dparalleldownloader {
    constructor(options) {
        this.options = Object.assign({}, defalutOptions, options)

        const { breakpoint, outdir, alias } = this.options
        const cltname = (path.isAbsolute(outdir) ? path.resolve(path.join(outdir, alias)) : path.resolve(path.join(outdir, alias))) + '.clt'

        if (!fs.existsSync(path.dirname(cltname))) fs.mkdirSync(path.dirname(cltname))
        // 如果不是断点续传，删除原始下载文件
        if (!breakpoint) fs.existsSync(cltname) && fs.unlinkSync(cltname)

        this.db = new sqlite3.Database(cltname)
        this.cltname = cltname
    }

    async download(tileset) {
        console.log(`开始下载（并行）：${tileset}`)
        const { db, cltname } = this
        const { query, clt, zip, outdir, alias } = this.options
        // 创建瓦片表
        await wrap(resolve => db.run('create table if not exists p("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, uri text not null, ext integer, d integer DEFAULT 0, x integer DEFAULT 0);', () => resolve()))
        // 创建瓦片表
        await wrap(resolve => db.run('create table if not exists tiles(md5 varchar(16) primary key not null, path text, tile blob, type varchar(20));', () => resolve()))

        const source = new URL(tileset)
        const searchParams = new URLSearchParams([source.searchParams.toString(), ...query].join('&'))
        const url = new URL(source.pathname.replace(/\\/g, '/'), source.origin)
        for (var pair of searchParams.entries()) {
            url.searchParams.append(pair[0], pair[1])
        }
        let row = await wrap(resove => db.get(`SELECT * FROM p`, (err, row) => resove(row)))
        if (row === undefined) {
            await wrap(resove => db.run(`INSERT INTO p (uri,ext,d) VALUES (?,1,0);`, url.pathname, (err, row) => resove(row)))
        }
        console.log(`光速读取目录树中，请等待...`);
        this.preload(url, path.parse(url.pathname).dir.replace(/\\/g, '/')).then(() => {
            if (!clt) {
                try {
                    console.log('执行解包')
                    const cmd = `npx clt2tiles "${cltname}" ${zip ? '--zip ' : ''} ${outdir ? '--outdir ' + outdir : ''} ${alias ? '--alias ' + alias : ''}`
                    childProcess.exec(cmd, { encoding: 'utf8' }, () => {
                        console.log('解包完毕')
                    }).stdout.pipe(process.stdout)

                } catch (err) {
                    console.log(err)
                }
            }
        })
    }
    async preload(url, root) {
        const { db } = this
        const { count, limit } = this.options
        const rows = await wrap(resolve => db.all(`SELECT id,uri FROM p WHERE ext=1 and d=0 LIMIT 0, ?; `, limit, (err, rows) => resolve(rows)))
        try {
            const result = await asyncPool(count, rows, p => axios.get(`${url.origin}${p.uri}`, { params: querystring.parse(url.searchParams.toString()) })
                .then(res => {
                    const { data } = res
                    const subfiles = []
                    const contenturi = _.get(data, 'root.content.uri')
                    const children = _.get(data, 'root.children') || []
                    contenturi && subfiles.push(path.join(root, contenturi).replace(/\\/g, '/'))
                    children.forEach(element => {
                        const childrenuri = _.get(element, 'content.uri')
                        children && subfiles.push(path.join(root, childrenuri).replace(/\\/g, '/'))
                    })
                    console.log(`request ${p.id} ${p.uri}`)
                    return {
                        id: p.id,
                        uri: p.uri,
                        files: subfiles.map(sub => /\.json$/i.test(sub) ? [sub, 1, 0] : [sub, 0, 1])
                    }
                }
                ))

            await new Promise(resolve => {
                db.serialize(function () {
                    db.run('BEGIN');
                    const stmt2 = db.prepare(`UPDATE p SET d=? WHERE id=?;`)
                    for (let n = 0; n < result.length; n++) {
                        const entity = result[n]
                        const stmt = db.prepare(`INSERT INTO p (uri,ext,d) VALUES (?,?,?);`)
                        for (let j = 0; j < entity.files.length; j++) {
                            const file = entity.files[j]
                            stmt.run(file)
                        }
                        stmt.finalize()
                        stmt2.run([1, entity.id])
                        console.log(`UPDATE ${entity.id} ${entity.uri}`)
                    }
                    stmt2.finalize()
                    db.run('COMMIT', resolve)
                });
            })
        } catch (e) {
            // 并行容易抛出请求出错
        }
        if (rows.length === 0) {
            console.log(`预读取完毕`)
            this.parsing(url, root)
        } else {
            this.preload(url, root)
        }
    }

    async parsing(url, root) {
        const { db } = this
        const { downloaded, skiped, zip, count, limit } = this.options

        // 读取需要下载的文件
        const rows = await wrap(resolve => db.all(`SELECT id,uri FROM p WHERE x = 0 LIMIT 0, ?;`, limit, (err, rows) => resolve(rows)))
        try {
            const result = rows.map(row => {
                const parse = path.parse(row.uri)
                const uri = `${url.origin}${row.uri}`
                const subpath = parse.dir.replace(root, '')

                const relative = path.join(subpath, parse.base).replace(/\\/g, '/')

                const md5 = crypto.createHash('md5').update(relative).digest('hex')
                return { uri, md5, relative }
            })
            const md5s = await wrap(resolve => {
                const ins = result.map(r => `'${r.md5}'`).join(',')
                db.all(`SELECT md5 FROM tiles WHERE md5 IN (${ins});`, (err, rows) => resolve(rows))
            })
            const list = _.differenceBy(result, md5s, 'md5')

            const allresult = await asyncPool(count, list, p => axios.get(p.uri, { params: querystring.parse(url.searchParams.toString()), responseType: 'arraybuffer' })
                .then(res => {
                    return {
                        ...p,
                        tile: res.data
                    }
                }
                ))
            await new Promise(resolve => {
                db.serialize(function () {
                    db.run('BEGIN');

                    const stmt = db.prepare('INSERT INTO tiles (md5,path,tile,type) VALUES (?,?,?,?);')
                    const stmt2 = db.prepare(`UPDATE p SET x=? WHERE id=?;`)

                    allresult.forEach(({ md5, relative, tile, uri }) => {
                        stmt.run([md5, relative, zip ? zlib.gzipSync(tile) : tile, 'file'])
                        downloaded && console.log(`Downloaded ${uri}`)
                    })
                    rows.forEach(({ id }) => stmt2.run([1, id]))
                    stmt.finalize()
                    stmt2.finalize()

                    db.run('COMMIT', resolve)
                });
            })
        }
        catch (e) {
            // 并行容易抛出请求出错
        }
        if (rows.length === 0) {
            console.log(`下载完毕`)
        } else {
            this.parsing(url, root)
        }
    }
}

exports.defalut = function (tilesurl, options) {
    const { parallel } = options
    if (!parallel) {
        const downloader = new tiles3ddownloader(options)
        downloader.download(tilesurl)
    } else {
        const downloader = new tiles3dparalleldownloader(options)
        downloader.download(tilesurl)
    }
}