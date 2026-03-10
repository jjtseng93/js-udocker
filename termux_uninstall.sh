#!/bin/sh

if head -c 10 "$PREFIX/bin/udocker" | grep -qi /bin/sh ; then
  rm "$PREFIX/bin/udocker"
  echo "Removed js-udocker: $PREFIX/bin/udocker"
  if head -c 50 "$PREFIX/bin/udocker.bak" | grep -qi python ; then
    mv "$PREFIX/bin/udocker.bak" "$PREFIX/bin/udocker"
    echo "Restored python udocker!"
  fi
else
  echo "js-udocker not found"
  exit 127
fi
