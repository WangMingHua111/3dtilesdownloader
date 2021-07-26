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
