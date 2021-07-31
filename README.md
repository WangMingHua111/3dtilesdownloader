# 3dtilesdownloader
通过 3dtiles文件网络路径，下载模型切片文件到本地，默认格式为clt，如果需要解压为目录使用 --no-clt 参数。



# install

  npm install -g 3dtilesdownloader

  **clt 单独解包**

  npm install -g clt2tiles

  clt2tiles 3dtiles.clt // 如果clt 使用了zip压缩: clt2tiles 3dtiles.clt --zip
  
# use

  // 使用并行、断点续传、内容压缩的方式下载tileset.json成clt，并在下载完毕后自动解压

  3dtilesdownloader "http://192.168.10.201/3dtiles/tileset.json" -b -z -p -c 20 -l 100 --no-clt
  
**并行下载的功能已经趋于稳定，建议使用并行下载，同时建议开启zip压缩和断点续传的功能（--zip --breakpoint），减少打包后需要迁移的数据量和避免数据重复下载。**


# 操作选项

**使用 3dtilesdownloader -h 查看帮助**

    .option('-o, --outdir <path>', 'change the output directory')
    .option('-a, --alias <name>', 'change the output directory alias,defalut is "3dtiles"')
    .option('-q, --query <param...>', 'query string')
    .option('-b, --breakpoint', 'breakpoint continuingly')
    .option('-z, --zip', 'zip compression')
    .option('-p, --parallel', 'parallel')
    .option('-c, --count <value>', 'parallel count defalut 20')
    .option('-l, --limit <value>', 'parallel page limit count defalut 100')
    .option('-m, --multiple', 'parallel multiple processes')
    .option('-w, --work <value>', 'parallel multiple processes count defalut 8')
    .option('--cltname <value>', 'parallel multiple processes cltname')
    .option('--no-clt', 'unpack clt')

    --outdir 指定输出目录
    --alias 指定输出目录下存储目录
    --query 请求查询参数格式为 --query a=1 b=2
    --breakpoint 断点续传，接续上一次下载断点处继续下载
    --zip 是否启用zip压缩，由于模型文件数据量大导致存储占用过大，运行是否使用zip进行压缩
    --parallel 是否使用并行模型进行下载
    --count 并行下载时瞬时最大请求数量，默认值 20
    --limit 并行下载时，从并行缓存中读取的记录数量，默认值 100
    --no-clt 默认下载格式为Cesuimlab 定义的 clt 格式，启用该选项后，将会在clt下载完毕后，自动解包为文件目录
    
    注意不要使用多进程模式，测试了还是有bug，逻辑上不知道哪里出了问题，导致过早结束的下载，似乎处于无限下载状态
