#!/bin/sh

sd=$(dirname "$(realpath "$0")")

if head -c 50 "$PREFIX/bin/udocker" | grep -qi python ; then
  echo "Python version already installed!"
  echo "Want to move it to udocker.bak?"
  echo -n "(Y/n)"
  read ans

  if echo $ans | grep -qi n ; then
    echo "Aborting install 取消安裝..."
    exit 1
  fi

  mv "$PREFIX/bin/udocker" "$PREFIX/bin/udocker.bak"
fi

if head -c 10 "$sd"/udocker_wrapper.sh | grep -qi /bin/sh ; then
  ln -sfT "$sd"/udocker_wrapper.sh "$PREFIX/bin/udocker"
  echo "Success: Installed to $PREFIX/bin/udocker"
  exit 0
fi

echo "Please enter the path for udocker_wrapper.sh"

read ans

if head -c 10 "$ans" | grep -qi /bin/sh ; then
  ln -sfT "$(realpath "$ans")" "$PREFIX/bin/udocker"
  echo "Success: Installed to $PREFIX/bin/udocker"
  exit 0
else
  echo "File not found or incorrect!"
  exit 127
fi
