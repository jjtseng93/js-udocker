#!/bin/sh

alias udocker='sh "$shr" node "$PKG_RDIR"/js-udocker/udocker.js'
alias proot-udocker='sh "$shr" proot -l -S / --bind="$PKG_RDIR/bin/mksh":/system/bin/sh --bind="$PKG_RDIR/bin/toybox":/system/bin/toybox /bin/sh "$shr" node "$PKG_RDIR"/js-udocker/udocker.js'

udroot="$HOME"/.udocker/containers

export LD_PRELOAD="" 


ensure_dns() {

  if ! [ -s "$rootfs"/etc/resolv.conf ] ; then
    printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n">"$rootfs"/etc/resolv.conf
  fi
  
  if ! [ -s "$rootfs"/tmp/resolv.conf ] ; then
    printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n">"$rootfs"/tmp/resolv.conf
  fi
  
}

ensure_non_primary_user() {
  if pwd | grep -E '/data/user/[^0][0-9]*/'>/dev/null ; then
    echo "Non-primary user, disabling apt sandbox" 1>&2
    sh "$PKG_RDIR"/proot/srprc "$rootfs" sh -c 'which apt && echo '\''APT::Sandbox::User "root";'\'' > /etc/apt/apt.conf.d/99no-sandbox'
  fi
}


if [ "$1" = "run" ] ; then
  shift 1

  entrypoint_mode="meta"
  entrypoint_value=""

  while printf "%s" "$1" | grep -q '^-' 
  do

    if printf "%s" "$1" | grep -q '\--name=' ; then
      cname=$(printf "%s" "$1" | grep -oE '\--name=[^ ]+' | cut -c8-)
    elif printf "%s" "$1" | grep -q '\--entrypoint=' ; then
      entrypoint_mode="set"
      entrypoint_value=$(printf "%s" "$1" | sed -e 's/^[^=]*=//')
      if [ -z "$entrypoint_value" ] ; then
        entrypoint_mode="clear"
      fi
    elif [ "$1" = "--entrypoint" ] ; then
      if [ -n "$2" ] && ! printf "%s" "$2" | grep -q '^-' ; then
        entrypoint_mode="set"
        entrypoint_value="$2"
        shift 1
      else
        entrypoint_mode="clear"
      fi
    elif [ "$1" = "--rm" ] ; then
      JS_UDOCKER_REMOVE=1
    elif [ "$1" = "--proot" ] ; then
      JS_UDOCKER_FORCE_PROOT=1
    fi

    shift 1
    
  done

 if [ -d "$udroot/$1" ] ; then
   cid="$1"
 else # no existing container
 
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

    rootfs="$PKG_RDIR/proot/$1"

    ensure_dns
    ensure_non_primary_user

    shift 1
    if [ -z "$1" ] ; then
      exec sh "$PKG_RDIR"/proot/srpr "$rootfs"
    else
      exec sh "$PKG_RDIR"/proot/srprc "$rootfs" "$@"
    fi
    
  fi # end if has proot/$1 and yes
  
  distro=$(printf "%s" "$1" | grep -oE '[^@]+' | head -n1)
  echo Creating container from "$distro" as "$cname" 1>&2

  udocker pull "$distro"

create_container() {
  if [ -z "$cname" ] ; then
    cid=$(udocker create "$distro")
  else
    udocker create --name="$cname" "$distro"
    cid=$cname
  fi
}

proot_create_container() {
  echo "  Using proot, may be slow..." 1>&2

  if [ -z "$cname" ] ; then
    cid=$(proot-udocker create "$distro")
  else
    proot-udocker create --name="$cname" "$distro"
    cid=$cname
  fi
}

  
  if [ -z "$JS_UDOCKER_FORCE_PROOT" ] ; then
    create_container
  else
    proot_create_container
  fi

  echo "Checking for /usr/bin/env: " 1>&2
  
  if ! ls "$udroot/$cid/ROOT/usr/bin/env" 1>&2 &&
     [ -z "$JS_UDOCKER_FORCE_PROOT" ] ; then
    
    echo "*** Failed to create from $distro ***" 1>&2

    udocker rm "$cid"
      
    proot_create_container
  fi
  

 fi # end if got cid
    # either $1 is container name/id or create one


  rootfs="$udroot/$cid"/ROOT

  ensure_dns
  ensure_non_primary_user

  # $1 is container name/id or distro name
  shift 1
  args_list=$(sh "$shr" node -e '
    const fs = require("fs");
    const jsonPath = process.argv[1];
    const entryMode = process.argv[2];
    const entryValue = process.argv[3];
    const userArgs = process.argv.slice(4);

    function norm(v) {
      if (Array.isArray(v)) return v;
      if (typeof v === "string") {
        const t = v.trim();
        return t ? t.split(/\s+/) : [];
      }
      return [];
    }

    let entryp = [];
    let cmd = [];
    if (jsonPath && fs.existsSync(jsonPath)) {
      try {
        const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        const cfg = j.config || {};
        cmd = norm(cfg.Cmd);
        if (entryMode === "meta") {
          entryp = norm(cfg.Entrypoint);
        }
      } catch {
        // ignore invalid metadata
      }
    }

    if (entryMode === "set") {
      entryp = norm(entryValue);
    } else if (entryMode === "clear") {
      entryp = [];
    }

    let finalArgs = [];
    if (userArgs.length > 0) {
      finalArgs = entryp.concat(userArgs);
    } else if (entryp.length > 0) {
      finalArgs = entryp.concat(cmd);
    } else if (cmd.length > 0) {
      finalArgs = cmd;
    }

    process.stdout.write(finalArgs.join("\n"));
  ' "$udroot/$cid/container.json" "$entrypoint_mode" "$entrypoint_value" "$@")


remove_container() {
  echo "Removing container..." 1>&2
  chmod -R 777 "$udroot/$cid/"
  udocker rm "$cid"
}


  if [ -z "$args_list" ] ; then
    if [ -z "$JS_UDOCKER_REMOVE" ] ; then
      exec sh "$PKG_RDIR"/proot/srpr "$rootfs"
    else
      sh "$PKG_RDIR"/proot/srpr "$rootfs"
      remove_container
    fi
  else
    set --
    while IFS= read -r line
    do
      set -- "$@" "$line"
    done <<EOF
$args_list
EOF

    if [ -z "$JS_UDOCKER_REMOVE" ] ; then
      exec sh "$PKG_RDIR"/proot/srprc "$rootfs" "$@"
    else
      sh "$PKG_RDIR"/proot/srprc "$rootfs" "$@"
      remove_container
    fi
    
  fi


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

  export cwd=$(pwd)
  
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
  if [ "$1" = "rm" ] ; then
    chmod -R 777 "$udroot/$2/"
  fi
  
  udocker "$@"

 if [ "$1" = "help" ] ||
     [ "$1" = "--help" ] ||
     [ "$1" = "-h" ] ||
     [ -z "$1" ]; then
  echo -e "\033[33m **Additional functions by wrapper:** \033[0m"
  echo "  udocker run --name=myap alpine"
  echo "  udocker run --rm node"
  echo "  udocker search bun"
  echo "  udocker dir ls -l"
  echo "  udocker dir sh"
  echo "  udocker dir <cmd>"
 fi

fi
