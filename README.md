# 3dtilesdownloader
通过 3dtiles文件网络路径，下载模型切片文件到本地

# install

  npm install -g 3dtilesdownloader
  
# use

  3dtilesdownloader "http://192.168.10.201/3dtiles/tileset.json" // 下载tileset.json
  
  3dtilesdownloader "http://192.168.10.201/3dtiles/tileset.json" -outdir temp // 下载文件，并输出到 temp/3dtiles 目录下
  
  3dtilesdownloader "http://192.168.10.201/3dtiles/tileset.json" --alias tiles // 下载文件，并输出到 tiles 目录下 
  
  3dtilesdownloader "http://192.168.10.201/3dtiles/tileset.json" -outdir temp --alias tiles // 下载文件，并输出到 temp/tiles 目录下 
  
  3dtilesdownloader "http://192.168.10.201/3dtiles/tileset.json" --breakpoint // 断点续传，避免重复下载
  
  3dtilesdownloader "http://192.168.10.201/3dtiles/tileset.json" --parallel // 并行下载
  
  3dtilesdownloader "http://192.168.10.201/3dtiles/tileset.json" --parallel --count // 并行下载数量

# 操作选项

- 使用 3dtilesdownloader -h 查看帮助

# 特别说明

**使用 --parallel 进行并行下载时，可能由于服务器方的调用次数限制或其他原因导致json源数据文件请求失败，导致部分json或模型下载失败，需要进行多次断点续传性质的并行下载。或者不使用并行下载**
