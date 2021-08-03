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
    parallel: true,
    count: 20,
    limit: 100,
}

function wrap(fn) {
    return new Promise((resolve, reject) => {
        fn(resolve, reject)
    })
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
                )
            )

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
                return { id: row.id, uri, md5, relative }
            })
            const md5s = await wrap(resolve => {
                const ins = result.map(r => `'${r.md5}'`).join(',')
                db.all(`SELECT md5 FROM tiles WHERE md5 IN (${ins});`, (err, rows) => resolve(rows))
            })
            const list = _.differenceBy(result, md5s, 'md5')

            const allresult = await asyncPool(count, list, p => axios.get(p.uri, { params: querystring.parse(url.searchParams.toString()), responseType: 'arraybuffer' })
                .then(res => {
                    downloaded && console.log(`Downloaded ${p.id} ${p.uri} ${res.statusText}`)
                    return {
                        ...p,
                        tile: res.data
                    }
                }
                ).catch((reason => {
                    downloaded && console.log(`Downloaded ${p.id} ${p.uri} ${reason.response.statusText}`)
                    return Promise.resolve(undefined)
                }))
            )

            console.time("Transaction Commit")
            await new Promise(resolve => {
                db.serialize(function () {
                    db.run('BEGIN');

                    const stmt = db.prepare('INSERT INTO tiles (md5,path,tile,type) VALUES (?,?,?,?);')
                    const stmt2 = db.prepare(`UPDATE p SET x=? WHERE id=?;`)

                    allresult.filter(p => p).forEach(({ id, md5, relative, tile }) => {
                        stmt.run([md5, relative, zip ? zlib.gzipSync(tile) : tile, 'file'])
                        stmt2.run([1, id])
                    })
                    stmt.finalize()
                    stmt2.finalize()

                    db.run('COMMIT', resolve)
                });
            })
            console.timeEnd("Transaction Commit")
        }
        catch (e) {
            // 并行容易抛出请求出错
        }
        if (rows.length === 0) {
            const next = await this.b3dm(root)
            if (next) {
                this.parsing(url, root)
            } else {
                console.log(`下载完毕`)
            }
        } else {
            this.parsing(url, root)
        }
    }
    /**
     * 解析b3dm文件，在所有文件下载完毕后执行
     * @returns boolean 返回值为true，代表需要下载资源文件，返回false代表执行完毕
     */
    async b3dm(root) {
        const { db } = this
        const { zip, limit } = this.options
        const exist = await wrap(resolve => db.get(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?;`, 'b3dm', (err, row) => resolve(row.count > 0 ? true : false)))
        if (!exist) {
            const temp = {}
            const size = Number(limit)
            const count = await wrap(resolve => db.get(`SELECT COUNT(md5) as count FROM tiles WHERE path LIKE '%.b3dm';`, (err, row) => resolve(row.count)))
            console.log(`所有文件已下载，正在解码把b3dm中存在的 URI，请等待...`)
            for (let i = 0; i < count; i += size) {
                const rows = await wrap(resolve => db.all(`SELECT md5,tile FROM tiles WHERE path LIKE '%.b3dm' LIMIT ?,?;`, [i, size], (err, rows) => resolve(rows)))
                rows.forEach(({ tile }) => {
                    const buffer = zip ? zlib.unzipSync(tile) : tile
                    // const buffer = zlib.unzipSync(tile)
                    const isb3dm = /^b3dm$/i.test(buffer.toString('ascii', 0, 4))
                    if (!isb3dm) return

                    // 解析b3dm
                    const version = buffer.readUInt32LE(1 * 4)
                    const byteLength = buffer.readUInt32LE(2 * 4)
                    const featureTableJSONByteLength = buffer.readUInt32LE(3 * 4)
                    const featureTableBinaryByteLength = buffer.readUInt32LE(4 * 4)
                    const batchTableJSONByteLength = buffer.readUInt32LE(5 * 4)
                    const batchTableBinaryByteLength = buffer.readUInt32LE(6 * 4)
                    const glbByteLength = byteLength - featureTableJSONByteLength - featureTableBinaryByteLength - batchTableJSONByteLength - batchTableBinaryByteLength - 28

                    // 解析glb
                    if (glbByteLength < 1) return

                    const glbBuffer = buffer.slice(28 + featureTableJSONByteLength + featureTableBinaryByteLength + batchTableJSONByteLength + batchTableBinaryByteLength, byteLength)
                    const isGLTF = /^glTF$/i.test(glbBuffer.toString('ascii', 0, 4))
                    if (!isGLTF) return
                    const glbVersion = glbBuffer.readUInt32LE(4)
                    if (glbVersion !== 2) return // 支持版本号为2
                    const glbLength = glbBuffer.readUInt32LE(8)
                    for (let i = 12; i < glbLength;) {
                        const chunkLength = glbBuffer.readUInt32LE(i)
                        const chunkType = glbBuffer.toString('ascii', i + 4, i + 8)
                        if (/^JSON$/i.test(chunkType)) {
                            const jsonStr = glbBuffer.toString('utf8', i + 8, i + 8 + chunkLength)
                            const obj = JSON.parse(jsonStr)
                            for (const key in obj) {
                                const o = obj[key]
                                if (typeof o !== 'object') { }
                                else if (Array.isArray(o)) {
                                    o.forEach(p => {
                                        const uri = _.get(p, 'uri')
                                        if (uri) {
                                            const md5 = crypto.createHash('md5').update(uri).digest('hex')
                                            temp[md5] = uri
                                        }
                                    })
                                } else {
                                    const uri = _.get(o, 'uri')
                                    if (uri) {
                                        const md5 = crypto.createHash('md5').update(uri).digest('hex')
                                        temp[md5] = uri
                                    }
                                }
                            }
                        }
                        i += (8 + chunkLength)
                    }
                })
                console.log(`${i + size}/${count}`)
            }
            console.log(`${count}/${count}`)
            const extraFiles = Object.keys(temp).map(key => path.join(root, temp[key]).replace(/\\/g, '/'))
            await new Promise(resolve => {
                db.serialize(function () {
                    db.run('BEGIN');
                    db.run(`create table b3dm("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, uri text not null);`)
                    const stmt = db.prepare(`INSERT INTO p (uri,ext,d) VALUES (?,?,?);`)
                    const stmt2 = db.prepare(`INSERT INTO b3dm (uri) VALUES (?);`)
                    for (let n = 0; n < extraFiles.length; n++) {
                        const file = extraFiles[n]

                        stmt.run([file, 2, 1])
                        stmt2.run([file])
                    }
                    stmt.finalize()
                    stmt2.finalize()
                    db.run('COMMIT', resolve)
                });
            })
            return extraFiles.length > 0
        } else {
            return false
        }
    }
}

exports.defalut = function (tilesurl, options) {
    const downloader = new tiles3dparalleldownloader(options)
    downloader.download(tilesurl)
}