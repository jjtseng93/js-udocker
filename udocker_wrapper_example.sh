#!/bin/sh

alias udocker='sh "$shr" node "$PKG_RDIR"/js-udocker/udocker.js'

udroot="$HOME"/.udocker/containers

if [ "$1" = "run" ] ; then
  shift 1

  if printf -- "$@" | grep -q '\--name=' ; then
    cname=$(printf -- "$@" | grep -oE '\--name=[^ ]+' | cut -c8-)
  fi

  while printf -- "$1" | grep -q '^-' 
  do
    shift 1
  done

 if [ -d "$udroot/$1" ] ; then
   cid="$1"
 else
  # has proot/$1
  if ! [ -z "$1" ] &&
     [ -d "$PKG_RDIR/proot/$1" ] ; then
    hasproot=1
    echo "Do you want to launch proot/$1 ?"
    printf "(Y/n)"
    read reply
  fi

  if ! [ -z "$hasproot" ] &&
     ! echo $reply | grep -qi n ; then
    export LD_PRELOAD="" 

    rootfs="$PKG_RDIR/proot/$1"

    if ! [ -s "$rootfs"/etc/resolv.conf ] ; then
      printf "nameserver 1.1.1.1\nnameserver 8.8.8.8">"$rootfs"/etc/resolv.conf
    fi

    exec sh "$PKG_RDIR"/proot/srpr "$rootfs"
    
  fi
  
  distro=$(printf -- "$1" | grep -oE '[^@]+' | head -n1)
  echo Creating container from "$distro" as "$cname" 1>&2

  udocker pull "$distro"


  if [ -z "$cname" ] ; then
    cid=$(udocker create "$distro")
  else
    udocker create --name="$cname" "$distro" 
    cid="$cname"
  fi


 fi # end if $1 is container name/id

  export LD_PRELOAD="" 

  rootfs="$udroot/$cid"/ROOT

  if ! [ -s "$rootfs"/etc/resolv.conf ] ; then
    printf "nameserver 1.1.1.1\nnameserver 8.8.8.8">"$rootfs"/etc/resolv.conf
  fi

  exec sh "$PKG_RDIR"/proot/srpr "$rootfs"

elif [ "$1" = "dir" ] ; then
  shift 1

  if [ "$1" = "-h" ] ||
     [ "$1" = "--help" ] ; then
    echo "Switches to containers dir"
    echo "and performs shell commands"
    echo "  Example: "
    echo "    udocker dir ls -l"
    echo "    udocker dir rm myalpine"
    
    exit
  fi
  
  cd "$udroot"
  
  if [ "$1" = "ls" ] ; then
    shift 1
    ls --color=auto "$@"
  elif [ "$1" = "grep" ] ; then
    shift 1
    grep --color=auto "$@"
  elif [ "$1" = "diff" ] ; then
    shift 1
    diff --color "$@"
  else
    "$@"
  fi
  
elif [ "$1" = "search" ] ; then
  sh "$shr" xdg-open "https://hub.docker.com/search?q=$2"
else
  udocker "$@"
fi
