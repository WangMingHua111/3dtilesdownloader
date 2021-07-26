# clt2tiles
将Cesuim实验室定义的clt文件提取为3dtiles目录

# install

  npm install -g clt2tiles
  
# use

  
  
  clt2tiles 3dtiles.clt // 提取clt文件
  
  clt2tiles 3dtiles.clt -outdir temp // 提取clt文件，并输出到3dtiles.clt目录的 temp/3dtiles 目录下
  
  clt2tiles 3dtiles.clt --alias tiles // 提取clt文件，并输出到3dtiles.clt目录的 tiles 目录下 
  
  clt2tiles 3dtiles.clt -outdir temp --alias tiles // 提取clt文件，并输出到3dtiles.clt目录的 temp/tiles 目录下 
  
  clt2tiles 3dtiles.clt --zip // 提取clt文件，并使用zip解压

# 操作选项

- 使用 clt2tiles -h 查看帮助

  -a, --alias <name> 输出文件夹别名
  
  -o, --outdir <path> 输出文件夹目录
  
  -z, --zip 如果clt存储的文件是使用zip压缩过的，请使用此命令解压
