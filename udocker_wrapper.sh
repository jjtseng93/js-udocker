#!/bin/sh

sd=$(dirname "$(realpath "$0")")


if [ -d /data/data/com.termux ] ; then
  alias udocker='node "$sd"/udocker.js'
  alias proot-udocker='proot -l -S / node "$sd"/udocker.js'
else
  alias udocker='sh "$shr" node "$sd"/udocker.js'
  alias proot-udocker='sh "$shr" proot -l -S / --bind="$PKG_RDIR/bin/mksh":/system/bin/sh --bind="$PKG_RDIR/bin/toybox":/system/bin/toybox /bin/sh "$shr" node "$sd"/udocker.js'
fi


udroot="$HOME"/.udocker/containers




script_runproot=$sd/scripts/srpr
script_runprootc=$sd/scripts/srprc

append_proot_extra_bind() {
  if [ -z "$PROOT_EXTRA_BIND" ] ; then
    PROOT_EXTRA_BIND=$1
  else
    PROOT_EXTRA_BIND=$(printf "%s\n%s" "$PROOT_EXTRA_BIND" "$1")
  fi
  export PROOT_EXTRA_BIND
}

append_proot_extra_env() {
  if [ -z "$PROOT_EXTRA_ENV" ] ; then
    PROOT_EXTRA_ENV=$1
  else
    PROOT_EXTRA_ENV=$(printf "%s\n%s" "$PROOT_EXTRA_ENV" "$1")
  fi
  export PROOT_EXTRA_ENV
}


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


remove_container() {
  echo "Removing container $cid..." 1>&2
  chmod -R 777 "$udroot/$cid/"
  udocker rm "$cid"
}


if [ "$1" = "run" ] ; then
  #export LD_PRELOAD= 
  shift 1

  entrypoint_mode="meta"
  entrypoint_value=""
  PROOT_EXTRA_ENV=
  export PROOT_EXTRA_ENV

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
      if [ -n "$2" ] && [ "${2#-}" = "$2" ] ; then
        entrypoint_mode="set"
        entrypoint_value="$2"
        shift 1
      else
        entrypoint_mode="clear"
      fi
    elif printf "%s" "$1" | grep -q '\--bind=' ; then
     append_proot_extra_bind "$1"
    elif [ "$1" = "-v" ] ||
         [ "$1" = "-b" ] ||
         [ "$1" = "--volume" ] ; then
     shift 1

     if echo "$1" | grep -qoE '^[^/]+:' ; then
       vname=$(echo "$1" | grep -oE '^[^:]+')
       vsuffix=$(echo "$1" | grep -oE ':.+$')

       realb=$HOME/.udocker/volumes/$vname

       mkdir -p "$realb" 2>/dev/null

       realb=$(printf "%s%s" "$realb" "$vsuffix")
     else
       realb=$1
     fi
     
     append_proot_extra_bind "--bind=$realb"
    elif [ "$1" = "-e" ] ||
         [ "$1" = "--env" ] ; then
      shift 1

      append_proot_extra_env "$1"
     
    elif [ "$1" = "--rm" ] ; then
      JS_UDOCKER_REMOVE=1
    elif [ "$1" = "-p" ] ; then
      shift 1

      hostp=$(echo "$1" | grep -oE '^[^:]+')
      contp=$(echo "$1" | grep -oE '[^:]+$')

      portdiff=$((hostp-contp))

      if [ "$portdiff" -gt 1000 ] ; then
        export PROOT_PORT_ADD=$portdiff
      fi
      
    elif [ "$1" = "-w" ] ||
         [ "$1" = "--workdir" ] ; then
      shift 1
      wd=$1
    elif [ "$1" = "--isolated" ] ; then
      script_runproot=$(printf "%si" "$script_runproot")
      script_runprootc=$(printf "%si" "$script_runprootc")
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

    if [ -t 0 ] ; then
      echo "Do you want to launch proot/$1 ?" 1>&2
      printf "(Y/n)" 1>&2
      read reply
    else
      reply=n
    fi
  fi

  if ! [ -z "$hasproot" ] &&
     ! echo $reply | grep -qi n ; then

    rootfs="$PKG_RDIR/proot/$1"
    container_name="proot/$1"

    ensure_dns
    ensure_non_primary_user

    shift 1
    if [ -z "$1" ] ; then
      echo "" 1>&2
      echo "Running $container_name with cmdline:" 1>&2
      echo -e "\033[33m  /bin/sh -l \033[0m" 1>&2
      echo "" 1>&2
      exec sh "$script_runproot" "$rootfs"
    else
      echo "" 1>&2
      echo "Running $container_name with cmdline:" 1>&2
      echo -e "\033[33m  $@ \033[0m" 1>&2
      echo "" 1>&2

      exec sh "$script_runprootc" "$rootfs" "$@"
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
    ldsave=$LD_PRELOAD
    LD_PRELOAD=
    cid=$(proot-udocker create "$distro")
    LD_PRELOAD=$ldsave
  else
    ldsave=$LD_PRELOAD
    LD_PRELOAD=
    proot-udocker create --name="$cname" "$distro"
    LD_PRELOAD=$ldsave
    
    cid=$cname
  fi
}

  
  if [ -z "$JS_UDOCKER_FORCE_PROOT" ] ; then
    create_container
  else
    proot_create_container
  fi

  echo "Checking /usr/bin/env /bin/sh: " 1>&2
  
  if ! ls "$udroot/$cid/ROOT/usr/bin/env" 1>&2 ||
     ! ls "$udroot/$cid/ROOT/bin/sh" 1>&2 ; then

    if [ -z "$JS_UDOCKER_FORCE_PROOT" ] ; then
    
      echo "*** Failed to create from $distro ***" 1>&2

      remove_container
      
      proot_create_container
      
    fi
    
  fi
  

 fi # end if got cid
    # either $1 is container name/id or create one


  rootfs="$udroot/$cid"/ROOT
  container_name=$cid

  ensure_dns
  ensure_non_primary_user

  # $1 is container name/id or distro name
  shift 1
  args_list=$(node -e '
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
    let cfg = {};
    
    if (jsonPath && fs.existsSync(jsonPath)) {
      try {
        const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        cfg = j.config || {};
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

    if(cfg.Env)
    {
      finalArgs.unshift("/usr/bin/env",...cfg.Env);
    }

    if(cfg.WorkingDir)
    {
      fs.writeFileSync(jsonPath
          .replace("container.json","WORKDIR"),
       cfg.WorkingDir);
    }

    process.stdout.write(finalArgs.join("\n"));
  ' "$udroot/$cid/container.json" "$entrypoint_mode" "$entrypoint_value" "$@")

  if [ -z "$wd" ] ; then
    wd=$(cat "$udroot/$cid/WORKDIR" 2>/dev/null)
  fi
  rwd=$(printf "%s%s" "$rootfs" "$wd")

  if ! [ -z "$wd" ] &&
     [ -d "$rwd" ] ; then
    append_proot_extra_bind "--cwd=$wd"
  fi

  if [ -z "$args_list" ] ; then
     
    echo "" 1>&2
    echo "Running $container_name with cmdline:" 1>&2
    echo -e "\033[33m  /bin/sh -l \033[0m" 1>&2
    echo "" 1>&2

    if [ -z "$JS_UDOCKER_REMOVE" ] ; then

      exec sh "$script_runproot" "$rootfs"
    else
      sh "$script_runproot" "$rootfs"
      status=$?
      remove_container
      exit $status
    fi
  else
    set --
    while IFS= read -r line
    do
      set -- "$@" "$line"
    done <<EOF
$args_list
EOF

    echo "" 1>&2
    echo "Running $container_name with cmdline:" 1>&2
    echo -e "\033[33m  $@ \033[0m" 1>&2
    echo "" 1>&2

    if [ -z "$JS_UDOCKER_REMOVE" ] ; then
      exec sh "$script_runprootc" "$rootfs" "$@"
    else
      sh "$script_runprootc" "$rootfs" "$@"

      status=$?
      remove_container
      exit $status
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

elif [ "$1" = "compose" ] ; then
  shift 1
  wd=.
  
  if echo "$@" | grep -qE '\-f [^ ]+' ; then
    yamlcli=$(echo "$@" | grep -oE '\-f [^ ]+' | grep -oE '[^ ]+$')
  fi

  if [ -f "$yamlcli" ] ; then
    yamlf=$yamlcli
    wd=$(dirname "$yamlf")
  elif [ -f compose.yaml ] ; then
      yamlf=compose.yaml
  elif [ -f compose.yml ] ; then
      yamlf=compose.yml
  elif [ -f docker-compose.yaml ] ; then
      yamlf=docker-compose.yaml
  elif [ -f docker-compose.yml ] ; then
      yamlf=docker-compose.yml
  else
    echo "Compose yaml not found!"
    exit 127
  fi

  echo Project folder: $wd 1>&2
  echo Compose yaml: $yamlf 1>&2

  exec node "$sd"/lib/compose.mjs "$yamlf" "$@"
  
elif [ "$1" = "search" ] ; then

  xdg-open "https://hub.docker.com/search?q=$2"  
  
else
 if [ "$1" = "rm" ] ; then
   #chmod -R 777 "$udroot/$2/"
   shift 1

   for dir in "$@"; do
     cid=$dir
     remove_container
   done

   exit
 else
  udocker "$@"
  ustatus=$?
 fi

 if [ "$1" = "help" ] ||
     [ "$1" = "--help" ] ||
     [ "$1" = "-h" ] ||
     [ -z "$1" ]; then
  echo -e "\033[33m **Additional functions by wrapper:** \033[0m"
  echo "  udocker run --name=myap alpine"
  echo "  udocker run --rm node"
  echo "  udocker compose [-y|-i] [--dry|--build-only]"
  echo "  udocker compose [--force-recreate]"
  echo "  udocker search bun"
  echo "  udocker dir ls -l"
  echo "  udocker dir sh"
  echo "  udocker dir <cmd>"
  echo ""
  echo "See js-udocker/README.md for more help"
 fi

 exit $ustatus
fi
