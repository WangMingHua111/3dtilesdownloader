const fs = require('fs')
const path = require('path')
const axios = require('axios')
const _ = require('lodash')
const querystring = require('querystring');
const { URL } = require('url');

async function download(url, searchParams, rootDir, breakpoint, parallel, count, root) {
    const newurl = new URL(url.pathname, url.origin)
    for (var pair of searchParams.entries()) {
        newurl.searchParams.append(pair[0], pair[1])
    }

    const parse = path.parse(url.pathname)

    const subfiles = []
    // 这是一个json文件需要进行解析
    if (parse.ext.match(/.json$/i)) {
        const res = await axios.get(`${url.origin}/${url.pathname}`, { params: querystring.parse(newurl.searchParams.toString()) })
        const uri = _.get(res.data, 'root.content.uri')
        const children = _.get(res.data, 'root.children') || []
        uri && subfiles.push(uri)
        children.forEach(element => {
            const suburi = _.get(element, 'content.uri')
            suburi && subfiles.push(suburi)
        })
    }

    const subpath = parse.dir.replace(root, '')
    const fullpath = path.join(rootDir, subpath, parse.base)
    if (breakpoint && fs.existsSync(fullpath)) {
        console.log(`${url.pathname} skiped`)
    } else {
        const resBlob = await axios.get(`${url.origin}/${url.pathname}`, { params: querystring.parse(newurl.searchParams.toString()), responseType: 'arraybuffer' })
        !fs.existsSync(path.dirname(fullpath)) && fs.mkdirSync(path.dirname(fullpath))
        fs.writeFileSync(fullpath, resBlob.data)
        console.log(`${url.pathname} downloaded`)
    }
    if (parallel) {
        const chunk = _.chunk(subfiles, count)
        for (let i = 0; i < chunk.length; i++) {
            await Promise.all(chunk[i].map(file => download(new URL(path.join(root, file), url.origin), searchParams, rootDir, breakpoint, parallel, count, root)))
        }
    }
    else
        for (let i = 0; i < subfiles.length; i++) {
            const file = subfiles[i]
            await download(new URL(path.join(root, file), url.origin), searchParams, rootDir, breakpoint, parallel, count, root)
        }
}

exports.defalut = function (tilesurl, { query = [], outdir = '', alias = '3dtiles', breakpoint = false, parallel = false, count = 50 }) {
    const url = new URL(tilesurl)
    const params = new URLSearchParams([url.searchParams.toString(), ...query].join('&'))
    const dir = path.isAbsolute(outdir) ? path.resolve(path.join(outdir, alias)) : path.resolve(path.join(outdir, alias))
    // 断点续传
    if (fs.existsSync(dir) && breakpoint) {
        // 目录已存在，断点续传
    } else if (!fs.existsSync(dir)) {
        // 文件目录不存在，创建目录
        fs.mkdirSync(dir, {
            recursive: true
        })
    } else {
        // 先删除已存在目录
        fs.rmdirSync(dir, {
            recursive: true
        })
        // 创建目录
        fs.mkdirSync(dir, {
            recursive: true
        })
    }
    download(url, params, dir, breakpoint, parallel, count, path.parse(url.pathname).dir)
}