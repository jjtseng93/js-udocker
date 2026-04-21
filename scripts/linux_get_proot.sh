#!/bin/sh

sd=$(dirname "$(realpath "$0")")

if [ -f "$sd"/proot.elf ] ; then
  exec "$sd"/proot.elf "$@"
fi

cd "$sd"

if ! [ -f v5.4.0.tar.gz ] ; then
  echo "Will download source code from 
https://github.com/proot-me/proot/archive/refs/tags/v5.4.0.tar.gz
"

  curl -kLO https://github.com/proot-me/proot/archive/refs/tags/v5.4.0.tar.gz

fi


  tar -xzf v5.4.0.tar.gz
  make -C proot-5.4.0/src

  if ! [ -f proot-5.4.0/src/proot ] ; then
    echo "Failed to compile proot!"
    exit 1
  fi

  cp proot-5.4.0/src/proot ./proot.elf
  cp proot-5.4.0/src/loader/loader .

  rm -r proot-5.4.0


cd - >/dev/null

exec "$sd"/proot.elf "$@"
